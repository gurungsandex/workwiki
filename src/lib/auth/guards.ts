import { redirect } from 'next/navigation';
import { getSession, type SessionUser } from './session';
import { loadSubject, anonymousSubject } from '@/lib/subject';
import { instanceSettings } from '@/lib/instance';
import type { Subject } from '@/lib/access/types';
import type { Viewer } from '@/lib/serialize';

/** Every employee-facing page starts here. Access is decided before render. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  return session.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect('/home');
  return user;
}

export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

export interface Reader {
  user: SessionUser;
  subject: Subject;
  viewer: Viewer;
}

/**
 * The reader, as the evaluator sees them. An admin without a profile of their
 * own gets a subject that matches nothing, so a gated instance shows them
 * exactly what an unclassified person would see rather than everything.
 */
export async function requireReader(): Promise<Reader> {
  const user = await requireUser();
  const settings = await instanceSettings();
  const subject = (await loadSubject(user.id)) ?? anonymousSubject(user.id, settings?.timeZone ?? 'UTC');
  return { user, subject, viewer: user.isAdmin ? 'admin' : 'employee' };
}
