import type { Sql } from 'postgres';
import { cookies } from 'next/headers';
import { hashToken, newToken, pseudonymise } from './tokens';

export const SESSION_COOKIE = '__Host-wwsession';

/** Sliding expiry with an absolute cap (spec §11). */
const SLIDING_MS = 1000 * 60 * 60 * 12; // 12 hours of inactivity
const ABSOLUTE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days maximum

export type SessionUser = {
  userId: string;
  sessionId: string;
  isAdmin: boolean;
  status: string;
};

export async function createSession(
  sql: Sql,
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await sql`
    INSERT INTO session
      (user_id, token_hash, expires_at, absolute_expires_at, ip_hash, user_agent)
    VALUES (${userId}::uuid, ${hashToken(token)},
            ${new Date(now + SLIDING_MS)}, ${new Date(now + ABSOLUTE_MS)},
            ${meta.ip ? pseudonymise(meta.ip) : null},
            ${meta.userAgent?.slice(0, 300) ?? null})`;
  return token;
}

/**
 * Resolves the current session, sliding its expiry. Returns null for a missing,
 * expired or revoked token, and for a deactivated user — deactivation takes
 * effect on the next request, not at the next login.
 */
export async function currentSession(sql: Sql): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await sql<
    { id: string; user_id: string; is_admin: boolean; status: string }[]
  >`
    SELECT s.id, s.user_id, u.is_admin, u.status
      FROM session s JOIN app_user u ON u.id = s.user_id
     WHERE s.token_hash = ${hashToken(token)}
       AND s.expires_at > now()
       AND s.absolute_expires_at > now()
       AND u.status = 'active'
       AND u.archived_at IS NULL`;

  const row = rows[0];
  if (!row) return null;

  await sql`
    UPDATE session
       SET last_seen_at = now(),
           expires_at = least(now() + ${`${SLIDING_MS} milliseconds`}::interval,
                              absolute_expires_at)
     WHERE id = ${row.id}::uuid`;

  return {
    userId: row.user_id,
    sessionId: row.id,
    isAdmin: row.is_admin,
    status: row.status,
  };
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Revocation is a delete. */
export async function revokeSession(sql: Sql, sessionId: string, userId: string) {
  await sql`DELETE FROM session WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid`;
}

export async function revokeAllSessions(sql: Sql, userId: string) {
  await sql`DELETE FROM session WHERE user_id = ${userId}::uuid`;
}
