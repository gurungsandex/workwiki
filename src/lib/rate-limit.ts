import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * Per-account and per-IP limits with progressive delay on login, reset and
 * invite redemption (spec §11). Counters live in Postgres, so a restart does
 * not clear them and a second app process shares them.
 */

export interface Limit {
  /** Attempts permitted inside the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export const LIMITS = {
  'login:account': { max: 10, windowSeconds: 900 },
  'login:ip': { max: 30, windowSeconds: 900 },
  'reset:account': { max: 5, windowSeconds: 3600 },
  'reset:ip': { max: 15, windowSeconds: 3600 },
  'register:ip': { max: 10, windowSeconds: 3600 },
  'redeem:ip': { max: 15, windowSeconds: 3600 },
  'search:user': { max: 120, windowSeconds: 60 },
  'feedback:user': { max: 30, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the window, floored at zero. */
  remaining: number;
  /** Seconds the caller should be delayed before its next attempt. */
  delaySeconds: number;
  retryAfterSeconds: number;
}

/**
 * Count one attempt. The delay grows with the overage, so a slow guesser is
 * slowed rather than told it has been detected.
 */
export async function consume(bucket: Bucket, key: string): Promise<RateLimitResult> {
  const limit = LIMITS[bucket];
  const rows = await db.execute<{ count: number; age: number }>(sql`
    INSERT INTO rate_limit (bucket, key, count, window_started_at)
    VALUES (${bucket}, ${key}, 1, now())
    ON CONFLICT (bucket, key) DO UPDATE SET
      count = CASE
        WHEN rate_limit.window_started_at < now() - make_interval(secs => ${limit.windowSeconds}) THEN 1
        ELSE rate_limit.count + 1
      END,
      window_started_at = CASE
        WHEN rate_limit.window_started_at < now() - make_interval(secs => ${limit.windowSeconds}) THEN now()
        ELSE rate_limit.window_started_at
      END
    RETURNING count, EXTRACT(EPOCH FROM (now() - window_started_at))::int AS age
  `);

  const row = rows.rows[0] as { count: number; age: number } | undefined;
  const count = row?.count ?? 1;
  const age = row?.age ?? 0;
  const over = count - limit.max;

  return {
    allowed: over <= 0,
    remaining: Math.max(0, limit.max - count),
    // Progressive: 1s, 2s, 4s … capped, applied before the failure is reported.
    delaySeconds: over <= 0 ? 0 : Math.min(8, 2 ** Math.min(over - 1, 3)),
    retryAfterSeconds: Math.max(1, limit.windowSeconds - age),
  };
}

/** Clear a bucket after a success, so one good login forgives earlier typos. */
export async function reset(bucket: Bucket, key: string): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limit WHERE bucket = ${bucket} AND key = ${key}`);
}

/** Apply the progressive delay without leaking that a limit exists. */
export async function applyDelay(result: RateLimitResult): Promise<void> {
  if (result.delaySeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, result.delaySeconds * 1000));
  }
}
