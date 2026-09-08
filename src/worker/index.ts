/**
 * The worker.
 *
 * pg-boss on the same Postgres the app already backs up — no fourth service
 * for a workload measured in dozens of jobs a day. It runs the housekeeping
 * that must not happen inside a request: expiring sessions and tokens,
 * re-checking external links, and sweeping rate-limit counters.
 *
 * Document extraction and OCR are M4 and are deliberately absent; when they
 * land they are jobs registered here, not a new service.
 */
import { PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db, getPool } from '../db/client';
import { loadEnv } from '../env';

const env = loadEnv();

const QUEUES = {
  sweepExpired: 'sweep-expired',
  checkLinks: 'check-links',
} as const;

function log(event: string, detail: Record<string, unknown> = {}): void {
  // Structured JSON, no PII.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n`);
}

/** Sessions, tokens and rate-limit windows that have run out. */
async function sweepExpired(): Promise<void> {
  const sessions = await db.execute<{ n: string }>(sql`
    WITH gone AS (
      DELETE FROM session
      WHERE absolute_expires_at < now() - interval '30 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
      RETURNING 1
    ) SELECT count(*)::text AS n FROM gone
  `);
  const tokens = await db.execute<{ n: string }>(sql`
    WITH gone AS (
      DELETE FROM auth_token
      WHERE expires_at < now() - interval '30 days'
      RETURNING 1
    ) SELECT count(*)::text AS n FROM gone
  `);
  const limits = await db.execute<{ n: string }>(sql`
    WITH gone AS (
      DELETE FROM rate_limit WHERE window_started_at < now() - interval '1 day' RETURNING 1
    ) SELECT count(*)::text AS n FROM gone
  `);

  log('sweep.expired', {
    sessions: Number((sessions.rows[0] as { n: string }).n),
    tokens: Number((tokens.rows[0] as { n: string }).n),
    rateLimits: Number((limits.rows[0] as { n: string }).n),
  });
}

/**
 * A dead external link at the worst possible moment is a real harm, so links
 * are re-checked on a schedule. A failure marks the block rather than hiding
 * it silently — an admin decides what to do.
 */
async function checkLinks(): Promise<void> {
  const rows = await db.execute<{ id: string; href: string }>(sql`
    SELECT id, data ->> 'href' AS href
    FROM block
    WHERE kind = 'external_link' AND archived_at IS NULL AND data ->> 'href' IS NOT NULL
    LIMIT 200
  `);

  let ok = 0;
  let broken = 0;
  for (const row of rows.rows) {
    const reachable = await reachable_(row.href);
    if (reachable) {
      ok++;
      await db.execute(sql`
        UPDATE block SET data = jsonb_set(data, '{lastVerifiedAt}', to_jsonb(now()::text)), updated_at = now()
        WHERE id = ${row.id}
      `);
    } else {
      broken++;
      await db.execute(sql`
        UPDATE block SET data = jsonb_set(data, '{broken}', 'true'::jsonb), updated_at = now() WHERE id = ${row.id}
      `);
    }
  }
  log('links.checked', { checked: rows.rows.length, ok, broken });
}

async function reachable_(href: string): Promise<boolean> {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      return response.status < 400;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });

  boss.on('error', (error: unknown) => log('boss.error', { message: (error as Error).message }));
  await boss.start();

  await boss.createQueue(QUEUES.sweepExpired);
  await boss.createQueue(QUEUES.checkLinks);

  await boss.work(QUEUES.sweepExpired, async () => {
    await sweepExpired();
  });
  await boss.work(QUEUES.checkLinks, async () => {
    await checkLinks();
  });

  await boss.schedule(QUEUES.sweepExpired, '17 3 * * *');
  await boss.schedule(QUEUES.checkLinks, '43 4 * * 1');

  log('worker.started', { build: env.BUILD_ID });

  const shutdown = async (signal: string) => {
    log('worker.stopping', { signal });
    await boss.stop({ graceful: true });
    await getPool().end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

await main();
