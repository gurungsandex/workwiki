import { sql } from '@/lib/db/client';
import { clearSessionCookie, currentSession, revokeSession } from '@/lib/auth/session';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  const db = sql();
  const session = await currentSession(db);
  if (session) await revokeSession(db, session.sessionId, session.userId);
  await clearSessionCookie();
  return json({ ok: true });
}
