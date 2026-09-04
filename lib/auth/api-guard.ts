import { sql } from '@/lib/db/client';
import { currentSession, type SessionUser } from './session';
import { loadSubject } from '@/lib/access/resolve-chain';
import type { Subject } from '@/lib/access/types';
import { problem } from '@/lib/http';

export type ApiViewer = { session: SessionUser; subject: Subject };

export async function apiSession(): Promise<
  { ok: true; session: SessionUser } | { ok: false; response: Response }
> {
  const session = await currentSession(sql());
  if (!session) return { ok: false, response: problem(401, 'Sign in to continue.') };
  return { ok: true, session };
}

export async function apiAdmin(): Promise<
  { ok: true; session: SessionUser } | { ok: false; response: Response }
> {
  const s = await apiSession();
  if (!s.ok) return s;
  if (!s.session.isAdmin) {
    return { ok: false, response: problem(404, 'Not found.') };
  }
  return s;
}

export async function apiViewer(): Promise<
  { ok: true; viewer: ApiViewer } | { ok: false; response: Response }
> {
  const s = await apiSession();
  if (!s.ok) return s;
  const subject = await loadSubject(sql(), s.session.userId);
  if (!subject) {
    return {
      ok: false,
      response: problem(403, 'Your employee record is not set up yet.'),
    };
  }
  return { ok: true, viewer: { session: s.session, subject } };
}
