import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { env } from '@/env';
import { storageReachable } from '@/lib/storage';
import { pendingMigrations } from '../../../scripts/migrate';

export const dynamic = 'force-dynamic';

/** Readiness: database, storage, migrations current. */
export async function GET() {
  const checks: Record<string, 'ok' | 'failing'> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'failing';
  }

  checks.storage = (await storageReachable()) ? 'ok' : 'failing';

  try {
    const pending = await pendingMigrations(async (query) =>
      db.execute<{ name: string }>(sql.raw(query)).then((r) => ({ rows: r.rows as { name: string }[] })),
    );
    checks.migrations = pending.length === 0 ? 'ok' : 'failing';
  } catch {
    checks.migrations = 'failing';
  }

  const ready = Object.values(checks).every((state) => state === 'ok');
  return NextResponse.json(
    { status: ready ? 'ready' : 'not-ready', build: env.BUILD_ID, checks },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
