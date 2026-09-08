/**
 * Forward-only migrations.
 *
 * Every file in `drizzle/` is applied once, in filename order, inside a
 * transaction, and recorded in `schema_migration`. There is no down path:
 * a mistake is corrected by a new file, never by rewinding a deployed one.
 * A file whose checksum no longer matches what was applied is a hard failure —
 * editing an applied migration is how two deployments quietly diverge.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadEnv } from '../src/env';

const DIR = join(process.cwd(), 'drizzle');

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir = DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export async function migrate(client: pg.Client): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map<string, string>(
    (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migration')).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );

  const ran: string[] = [];
  for (const file of readMigrations()) {
    const seen = applied.get(file.name);
    if (seen) {
      if (seen !== file.checksum) {
        throw new Error(
          `Migration ${file.name} has changed since it was applied.\n` +
            'Applied migrations are immutable. Add a new migration instead of editing this one.',
        );
      }
      continue;
    }
    process.stdout.write(`  applying ${file.name}\n`);
    await client.query('BEGIN');
    try {
      for (const statement of file.sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim();
        if (trimmed) await client.query(trimmed);
      }
      await client.query('INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)', [file.name, file.checksum]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file.name} failed: ${(error as Error).message}`, { cause: error });
    }
    ran.push(file.name);
  }
  return ran;
}

/** True when every migration on disk has been applied. Backs /readyz. */
export async function pendingMigrations(query: (sql: string) => Promise<{ rows: { name: string }[] }>) {
  const applied = new Set((await query('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  return readMigrations()
    .filter((m) => !applied.has(m.name))
    .map((m) => m.name);
}

const isEntrypoint = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isEntrypoint) {
  const env = loadEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const ran = await migrate(client);
    process.stdout.write(ran.length ? `Applied ${ran.length} migration(s).\n` : 'Database is up to date.\n');
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
