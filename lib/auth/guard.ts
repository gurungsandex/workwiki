import { redirect } from 'next/navigation';
import { sql } from '@/lib/db/client';
import { currentSession, type SessionUser } from './session';
import { loadSubject } from '@/lib/access/resolve-chain';
import type { Subject } from '@/lib/access/types';

/**
 * Access is decided server-side BEFORE render. These guards run in server
 * components and route handlers; nothing reaches the client unfiltered.
 */

export async function requireSession(): Promise<SessionUser> {
  const session = await currentSession(sql());
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireSession();
  if (!session.isAdmin) {
    // Not 403: an employee has no business learning that admin routes exist.
    redirect('/');
  }
  return session;
}

export type Viewer = {
  session: SessionUser;
  subject: Subject;
  isManager: boolean;
};

/**
 * The employee viewer: session plus the resolved access Subject. A user with no
 * profile row cannot be evaluated, so they are sent to a page that says so
 * rather than silently seeing nothing.
 */
export async function requireViewer(): Promise<Viewer> {
  const session = await requireSession();
  const subject = await loadSubject(sql(), session.userId);
  if (!subject) redirect('/no-profile');

  const rows = await sql()<{ n: string }[]>`
    SELECT count(*)::text AS n FROM employee_profile
     WHERE archived_at IS NULL AND user_id <> ${session.userId}::uuid
       AND user_id IN (SELECT user_id FROM employee_profile WHERE false)`;

  return { session, subject, isManager: Number(rows[0]?.n ?? 0) > 0 };
}

/** Whether setup has been completed, used to route a fresh install. */
export async function setupComplete(): Promise<boolean> {
  const rows = await sql()<{ n: string }[]>`
    SELECT count(*)::text AS n FROM app_user WHERE is_admin AND status = 'active'`;
  return Number(rows[0]?.n ?? 0) > 0;
}
