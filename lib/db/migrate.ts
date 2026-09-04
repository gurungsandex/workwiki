import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Forward-only migration runner.
 *
 * Files are applied in filename order, once each, inside a transaction, with an
 * advisory lock so two booting containers cannot race. There is no `down`: the
 * spec's upgrade path is `git pull && docker compose up --build`.
 */

const LOCK_ID = 8_531_204_771;

export async function migrate(databaseUrl: string, opts: { silent?: boolean } = {}) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = postgres(databaseUrl, { max: 1 });
  const log = (m: string) => {
    if (!opts.silent) process.stdout.write(`${m}\n`);
  };

  try {
    await client`SELECT pg_advisory_lock(${LOCK_ID})`;
    await client`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;

    const applied = new Set(
      (await client<{ filename: string }[]>`SELECT filename FROM schema_migration`).map(
        (r) => r.filename,
      ),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(dir, file), 'utf8');
      await client.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migration (filename) VALUES (${file})`;
      });
      log(`  applied ${file}`);
      count += 1;
    }
    log(count === 0 ? 'Migrations already current.' : `Applied ${count} migration(s).`);
    return count;
  } finally {
    await client`SELECT pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
    await client.end({ timeout: 5 });
  }
}

/** True when no migration file is pending — used by /readyz. */
export async function migrationsCurrent(databaseUrl: string): Promise<boolean> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await client<{ n: string }[]>`
      SELECT count(*)::text AS n FROM schema_migration`;
    return Number(rows[0]?.n ?? 0) >= files.length;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write(
      '\nCannot migrate: DATABASE_URL is not set.\n' +
        '      expected: a postgres:// connection string\n' +
        '      example:  DATABASE_URL=postgres://workwiki:workwiki@localhost:5432/workwiki\n\n',
    );
    process.exit(1);
  }
  migrate(url).catch((e: unknown) => {
    process.stderr.write(`\nMigration failed: ${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  });
}
