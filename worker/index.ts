import PgBoss from 'pg-boss';
import { pruneAttempts } from '@/lib/auth/rate-limit';
import postgres from 'postgres';

/**
 * The background worker.
 *
 * pg-boss owns its own schema in the same Postgres, so there is no fourth
 * service to run. Jobs registered here are the ones the MVP needs; extraction,
 * OCR and link checking arrive with M4 and M5.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('\nCannot start the worker: DATABASE_URL is not set.\n\n');
    process.exit(1);
  }

  const boss = new PgBoss({ connectionString: url });
  boss.on('error', (error) => {
    process.stderr.write(`worker error: ${error.message}\n`);
  });
  await boss.start();

  const sql = postgres(url, { max: 2 });

  // Housekeeping: expired sessions, consumed tokens and stale rate-limit rows.
  await boss.work('housekeeping', async () => {
    await sql`DELETE FROM session WHERE absolute_expires_at < now()`;
    await sql`DELETE FROM auth_token WHERE expires_at < now() - interval '7 days'`;
    await pruneAttempts(sql);
  });

  await boss.schedule('housekeeping', '0 * * * *');

  process.stdout.write('Worker ready.\n');

  const shutdown = async () => {
    await boss.stop({ graceful: true });
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e: unknown) => {
  process.stderr.write(`Worker failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
