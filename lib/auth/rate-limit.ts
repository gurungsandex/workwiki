import type { Sql } from 'postgres';
import { pseudonymise } from './tokens';

/**
 * Per-account AND per-IP limits with progressive delay on login, reset and
 * invite redemption (spec §11). Backed by the same Postgres everything else
 * uses, so there is no fourth service to run.
 */

export type Purpose = 'login' | 'reset' | 'invite';

const WINDOW_MINUTES = 15;
const LIMITS: Record<Purpose, { perIdentity: number; perIp: number }> = {
  login: { perIdentity: 8, perIp: 40 },
  reset: { perIdentity: 4, perIp: 20 },
  invite: { perIdentity: 6, perIp: 30 },
};

export type RateVerdict = { allowed: boolean; delayMs: number; retryAfterSec: number };

/** Progressive delay: doubles per attempt over the limit, capped. */
function progressiveDelay(attempts: number, limit: number): number {
  if (attempts <= limit) return 0;
  return Math.min(2 ** (attempts - limit) * 250, 8000);
}

export async function checkRateLimit(
  sql: Sql,
  purpose: Purpose,
  identity: string | null,
  ip: string | null,
): Promise<RateVerdict> {
  const limits = LIMITS[purpose];
  const since = `${WINDOW_MINUTES} minutes`;

  const buckets: string[] = [];
  if (identity) buckets.push(`id:${identity.toLowerCase()}`);
  if (ip) buckets.push(`ip:${pseudonymise(ip).toString('hex')}`);
  if (buckets.length === 0) return { allowed: true, delayMs: 0, retryAfterSec: 0 };

  const rows = await sql<{ bucket: string; n: string }[]>`
    SELECT bucket, count(*)::text AS n
      FROM auth_attempt
     WHERE purpose = ${purpose}
       AND bucket = ANY(${buckets}::text[])
       AND at > now() - ${since}::interval
     GROUP BY bucket`;

  let worstDelay = 0;
  let blocked = false;
  for (const row of rows) {
    const isIp = row.bucket.startsWith('ip:');
    const limit = isIp ? limits.perIp : limits.perIdentity;
    const n = Number(row.n);
    if (n >= limit * 3) blocked = true;
    worstDelay = Math.max(worstDelay, progressiveDelay(n, limit));
  }

  return {
    allowed: !blocked,
    delayMs: worstDelay,
    retryAfterSec: blocked ? WINDOW_MINUTES * 60 : Math.ceil(worstDelay / 1000),
  };
}

export async function recordAttempt(
  sql: Sql,
  purpose: Purpose,
  identity: string | null,
  ip: string | null,
) {
  const rows: { bucket: string; purpose: Purpose }[] = [];
  if (identity) rows.push({ bucket: `id:${identity.toLowerCase()}`, purpose });
  if (ip) rows.push({ bucket: `ip:${pseudonymise(ip).toString('hex')}`, purpose });
  if (rows.length === 0) return;
  await sql`INSERT INTO auth_attempt ${sql(rows, 'bucket', 'purpose')}`;
}

export async function clearAttempts(sql: Sql, purpose: Purpose, identity: string) {
  await sql`DELETE FROM auth_attempt
             WHERE purpose = ${purpose} AND bucket = ${`id:${identity.toLowerCase()}`}`;
}

export async function pruneAttempts(sql: Sql) {
  await sql`DELETE FROM auth_attempt WHERE at < now() - interval '1 day'`;
}

/** Deliberate constant delay so a hit and a miss take the same time. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
