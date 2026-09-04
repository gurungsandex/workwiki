import { sql } from '@/lib/db/client';
import { clearSessionCookie, currentSession, revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/audit/write';
import { clientIp, json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Sign out everywhere. Sessions are rows, so this is one statement. */
export async function POST() {
  const db = sql();
  const session = await currentSession(db);
  if (!session) return problem(401, 'Sign in to continue.');

  await revokeAllSessions(db, session.userId);
  await clearSessionCookie();
  await audit(db, {
    actorUserId: session.userId,
    action: 'auth.logout_all',
    area: 'People',
    targetType: 'app_user',
    targetId: session.userId,
    ip: await clientIp(),
  });
  return json({ ok: true });
}
