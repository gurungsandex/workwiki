import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { checkRateLimit, recordAttempt } from '@/lib/auth/rate-limit';

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

/**
 * The limiter's contract, pinned. Timings in a smoke test are too noisy to
 * establish this; the mapping from attempt count to verdict is not.
 */
run('login throttling', () => {
  let sql: postgres.Sql;
  const EMAIL = 'throttle@example.test';

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= 'a'.repeat(64);
    sql = postgres(URL!, { max: 1 });
  });
  afterAll(async () => {
    await sql`DELETE FROM auth_attempt`;
    await sql?.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await sql`DELETE FROM auth_attempt`;
  });

  const attempt = async (n: number) => {
    for (let i = 0; i < n; i++) await recordAttempt(sql, 'login', EMAIL, null);
    return checkRateLimit(sql, 'login', EMAIL, null);
  };

  it('is free below the soft limit', async () => {
    for (const n of [0, 1, 2, 3, 4, 5]) {
      await sql`DELETE FROM auth_attempt`;
      const v = await attempt(n);
      expect({ n, allowed: v.allowed, delayMs: v.delayMs }).toEqual({
        n,
        allowed: true,
        delayMs: 0,
      });
    }
  });

  it('doubles the delay past the soft limit, and caps it', async () => {
    const seen: number[] = [];
    for (const n of [6, 7, 8, 9, 10]) {
      await sql`DELETE FROM auth_attempt`;
      seen.push((await attempt(n)).delayMs);
    }
    // 2^(n-5) * 250, capped at 8000.
    expect(seen).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('refuses outright at the hard limit', async () => {
    await sql`DELETE FROM auth_attempt`;
    expect((await attempt(9)).allowed).toBe(true);
    await sql`DELETE FROM auth_attempt`;
    const blocked = await attempt(10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('throttles per identity, so one account cannot exhaust another', async () => {
    await attempt(12);
    const other = await checkRateLimit(sql, 'login', 'someone-else@example.test', null);
    expect(other.allowed).toBe(true);
    expect(other.delayMs).toBe(0);
  });

  it('counts an IP bucket separately when a client IP is available', async () => {
    for (let i = 0; i < 25; i++) {
      await recordAttempt(sql, 'login', `user${i}@example.test`, '203.0.113.7');
    }
    // Varying the email does not escape the per-IP bucket.
    const v = await checkRateLimit(sql, 'login', 'fresh@example.test', '203.0.113.7');
    expect(v.delayMs).toBeGreaterThan(0);
  });
});
