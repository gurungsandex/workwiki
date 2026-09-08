import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { env } from '@/env';
import { hashIp, hashToken, newToken } from '@/lib/crypto';

/**
 * Opaque server-side sessions. The row is the session: "sign out everywhere"
 * and the admin session list are ordinary queries, and revocation is a delete.
 */

export const SESSION_COOKIE = '__Host-ww_session';
export const SESSION_COOKIE_INSECURE = 'ww_session';

/** Sliding expiry … */
const IDLE_SECONDS = 60 * 60 * 24 * 14;
/** … with an absolute cap that is never extended. */
const ABSOLUTE_SECONDS = 60 * 60 * 24 * 90;
/** Don't write to the session row on every request. */
const TOUCH_AFTER_SECONDS = 60 * 5;

function secure(): boolean {
  return env.APP_BASE_URL.startsWith('https://');
}

export function sessionCookieName(): string {
  // __Host- requires Secure and a https origin; fall back for local http.
  return secure() ? SESSION_COOKIE : SESSION_COOKIE_INSECURE;
}

export interface SessionUser {
  id: string;
  email: string;
  isAdmin: boolean;
  status: string;
  emailVerifiedAt: Date | null;
}

export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken(32);
  const hdrs = await headers();
  const now = Date.now();

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: (hdrs.get('user-agent') ?? '').slice(0, 300) || null,
    ipHash: hashIp(clientIp(hdrs)),
    expiresAt: new Date(now + IDLE_SECONDS * 1000),
    absoluteExpiresAt: new Date(now + ABSOLUTE_SECONDS * 1000),
  });

  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_SECONDS,
  });

  return token;
}

/** Resolve the caller. Returns null for anonymous, expired or revoked. */
export async function getSession(): Promise<ActiveSession | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      archivedAt: users.archivedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.absoluteExpiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.archivedAt || row.status === 'deactivated') return null;

  const staleBy = Date.now() - row.lastSeenAt.getTime();
  if (staleBy > TOUCH_AFTER_SECONDS * 1000) {
    const slid = new Date(Math.min(Date.now() + IDLE_SECONDS * 1000, row.absoluteExpiresAt.getTime()));
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: slid })
      .where(eq(sessions.id, row.sessionId));
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, row.id));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.id,
      email: row.email,
      isAdmin: row.isAdmin,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
    },
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const name = sessionCookieName();
  const token = store.get(name)?.value;
  if (token) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(name);
}

/** Sign out everywhere: one query, because sessions are rows. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    WITH revoked AS (
      UPDATE session SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
        ${exceptSessionId ? sql`AND id <> ${exceptSessionId}` : sql``}
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM revoked
  `);
  return Number((result.rows[0] as { count: string } | undefined)?.count ?? 0);
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export function clientIp(hdrs: Headers): string | null {
  if (!env.TRUST_PROXY) return null;
  const forwarded = hdrs.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return hdrs.get('x-real-ip');
}
