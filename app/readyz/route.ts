import { sql } from '@/lib/db/client';
import { env } from '@/lib/env';
import { migrationsCurrent } from '@/lib/db/migrate';
import { storageReady } from '@/lib/files/store';

export const dynamic = 'force-dynamic';

/**
 * Readiness: database, storage, migrations current. Reports WHICH check failed,
 * because "not ready" with no reason is what makes a self-host fail twice.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await sql()`SELECT 1`;
    checks.database = { ok: true };
  } catch (e) {
    checks.database = { ok: false, detail: message(e) };
  }

  try {
    checks.storage = { ok: await storageReady() };
  } catch (e) {
    checks.storage = { ok: false, detail: message(e) };
  }

  try {
    const current = await migrationsCurrent(env().DATABASE_URL);
    checks.migrations = current
      ? { ok: true }
      : { ok: false, detail: 'Migrations are pending.' };
  } catch (e) {
    checks.migrations = { ok: false, detail: message(e) };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json(
    { status: ok ? 'ready' : 'not-ready', checks },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}
