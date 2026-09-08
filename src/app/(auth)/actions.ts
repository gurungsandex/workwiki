'use server';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { employeeProfiles, tenureAnchors, users } from '@/db/schema';
import { env } from '@/env';
import { assertCsrf, CSRF_FIELD, CsrfError } from '@/lib/csrf';
import { appendAudit } from '@/lib/audit';
import { hashIp } from '@/lib/crypto';
import { checkPassword, hashPassword, passwordNeedsRehash, verifyPassword } from '@/lib/auth/password';
import { clientIp, createSession, destroySession, revokeAllSessions } from '@/lib/auth/session';
import { getSession } from '@/lib/auth/session';
import { consumeToken, issueToken, peekToken, revokeTokens } from '@/lib/auth/tokens';
import { applyDelay, consume, reset } from '@/lib/rate-limit';
import { instanceSettings } from '@/lib/instance';
import { sendMail } from '@/lib/mail';

/**
 * Auth mutations.
 *
 * Failure messages never reveal whether an address exists, and both the
 * per-account and the per-IP limit are consumed before the answer is given.
 */

export interface FormState {
  error?: string;
  notice?: string;
}

const GENERIC_FAILURE = 'That email address and password do not match an account here.';

/**
 * A real Argon2id hash of a value nobody knows, computed once per process. It
 * exists so that a sign-in attempt against an unknown address costs the same
 * as one against a known address.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomUUID() + randomUUID());
  return decoy;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

async function ip(): Promise<string> {
  return hashIp(clientIp(await headers())) ?? 'unknown';
}

function emailAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return allowlist.some((entry) => domain === entry.toLowerCase().replace(/^@/, ''));
}

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch (error) {
    return { error: error instanceof CsrfError ? error.message : 'That request could not be verified.' };
  }

  const email = field(form, 'email').toLowerCase();
  const password = form.get('password');
  if (!email || typeof password !== 'string' || password.length === 0) return { error: GENERIC_FAILURE };

  const byIp = await consume('login:ip', await ip());
  const byAccount = await consume('login:account', email);
  await applyDelay(byIp.delaySeconds > byAccount.delaySeconds ? byIp : byAccount);
  if (!byIp.allowed || !byAccount.allowed) {
    return { error: 'Too many attempts. Wait a few minutes and try again.' };
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      status: users.status,
      lockedUntil: users.lockedUntil,
      failedAttempts: users.failedAttempts,
      emailVerifiedAt: users.emailVerifiedAt,
      archivedAt: users.archivedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Verify against a real hash even when no account matches, so the time taken
  // does not say whether the address exists.
  const stored = user?.passwordHash ?? (await decoyHash());
  const ok = await verifyPassword(stored, password);

  if (!user || !user.passwordHash || !ok || user.archivedAt || user.status === 'deactivated') {
    if (user) {
      await db
        .update(users)
        .set({
          failedAttempts: user.failedAttempts + 1,
          lockedUntil: user.failedAttempts + 1 >= 10 ? new Date(Date.now() + 15 * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
    }
    return { error: GENERIC_FAILURE };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: 'This account is locked for a few minutes after repeated attempts. Try again shortly.' };
  }

  // Parameters may have been raised since this hash was made.
  if (passwordNeedsRehash(user.passwordHash)) {
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
  }

  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await reset('login:account', email);
  await createSession(user.id);
  await appendAudit({ actorUserId: user.id, action: 'auth.sign-in', area: 'Auth', summary: 'Signed in.' });

  redirect('/home');
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  await destroySession();
  if (session) {
    await appendAudit({ actorUserId: session.user.id, action: 'auth.sign-out', area: 'Auth', summary: 'Signed out.' });
  }
  redirect('/sign-in');
}

export async function signOutEverywhere(): Promise<void> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const count = await revokeAllSessions(session.user.id);
  await appendAudit({
    actorUserId: session.user.id,
    action: 'auth.sign-out-all',
    area: 'Auth',
    summary: `Signed out of ${count} session${count === 1 ? '' : 's'}, this one included.`,
  });
  redirect('/sign-in');
}

/** Registration by invite. There is no open sign-up: an invite is required. */
export async function register(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const token = field(form, 'token');
  const password = String(form.get('password') ?? '');
  const displayName = field(form, 'displayName');

  const byIp = await consume('redeem:ip', await ip());
  await applyDelay(byIp);
  if (!byIp.allowed) return { error: 'Too many attempts. Wait a few minutes and try again.' };

  const invite = await peekToken('invite', token);
  if (!invite) return { error: 'That invitation has expired or has already been used. Ask for a new link.' };

  const email = (invite.email ?? field(form, 'email')).toLowerCase();
  if (!email) return { error: 'This invitation does not carry an email address. Ask for a new link.' };

  const settings = await instanceSettings();
  if (settings && !emailAllowed(email, settings.emailDomainAllowlist)) {
    return { error: 'That email address is not on this deployment’s allowlist.' };
  }

  const problem = checkPassword(password, { email });
  if (problem) return { error: problem.message };
  if (!displayName) return { error: 'Tell us the name your colleagues will see.' };

  /*
   * An invitation may only ever land on an account that has not been claimed.
   * Without this, a link issued without an address could be redeemed against
   * somebody else's email and would reset their password — an invitation is
   * not a password reset, and must never become one.
   */
  const [claimed] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (claimed && (claimed.passwordHash !== null || claimed.status !== 'invited')) {
    return { error: 'There is already an account for that address. Sign in, or reset the password instead.' };
  }

  const consumed = await consumeToken('invite', token);
  if (!consumed) return { error: 'That invitation has just been used. Ask for a new link.' };

  const payload = consumed.payload as {
    departmentId?: string;
    roleId?: string;
    employeeTypeId?: string;
    locationId?: string;
    hireDate?: string;
    isAdmin?: boolean;
  };

  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const id =
      existing?.id ??
      (
        await tx
          .insert(users)
          .values({ email, passwordHash, status: 'active', isAdmin: payload.isAdmin ?? false })
          .returning({ id: users.id })
      )[0]!.id;

    if (existing) {
      await tx
        .update(users)
        .set({ passwordHash, status: 'active', emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id));
    }

    await tx
      .insert(employeeProfiles)
      .values({
        userId: id,
        displayName,
        departmentId: payload.departmentId ?? null,
        roleId: payload.roleId ?? null,
        employeeTypeId: payload.employeeTypeId ?? null,
        locationId: payload.locationId ?? null,
        hireDate: payload.hireDate ?? null,
      })
      .onConflictDoUpdate({ target: employeeProfiles.userId, set: { displayName, updatedAt: new Date() } });

    if (payload.hireDate) {
      await tx
        .insert(tenureAnchors)
        .values({ userId: id, key: 'hire_date', date: payload.hireDate })
        .onConflictDoUpdate({ target: [tenureAnchors.userId, tenureAnchors.key], set: { date: payload.hireDate } });
    }
    return id;
  });

  await sendVerification(userId, email);
  await createSession(userId);
  await appendAudit({
    actorUserId: userId,
    action: 'auth.register',
    area: 'People',
    targetType: 'user',
    targetId: userId,
    summary: `${displayName} accepted an invitation and set a password.`,
  });

  redirect('/home');
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const { token } = await issueToken({ purpose: 'verify_email', userId, email });
  await sendMail({
    to: email,
    subject: 'Confirm your email address',
    text: `Confirm this address to finish setting up your handbook account:\n\n${env.APP_BASE_URL}/verify?token=${token}\n\nThe link works once and expires in three days.`,
  });
}

export async function requestReset(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const email = field(form, 'email').toLowerCase();
  const byIp = await consume('reset:ip', await ip());
  const byAccount = await consume('reset:account', email || 'blank');
  await applyDelay(byIp.delaySeconds > byAccount.delaySeconds ? byIp : byAccount);

  // The same sentence either way: whether an address is on file is not
  // something an unauthenticated caller gets to learn.
  const generic = { notice: 'If that address belongs to an account here, a reset link is on its way.' };
  if (!byIp.allowed || !byAccount.allowed || !email) return generic;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.archivedAt)))
    .limit(1);
  if (!user) return generic;

  await revokeTokens('password_reset', user.id);
  const { token } = await issueToken({ purpose: 'password_reset', userId: user.id, email });
  await sendMail({
    to: email,
    subject: 'Reset your handbook password',
    text: `Set a new password here:\n\n${env.APP_BASE_URL}/reset?token=${token}\n\nThe link works once and expires in an hour. If you did not ask for it, nothing has changed.`,
  });
  return generic;
}

export async function confirmReset(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const token = field(form, 'token');
  const password = String(form.get('password') ?? '');

  const peeked = await peekToken('password_reset', token);
  if (!peeked?.userId) return { error: 'That link has expired or has already been used. Ask for a new one.' };

  const problem = checkPassword(password, { email: peeked.email ?? undefined });
  if (problem) return { error: problem.message };

  const consumed = await consumeToken('password_reset', token);
  if (!consumed?.userId) return { error: 'That link has just been used. Ask for a new one.' };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, consumed.userId));

  // A password change signs out every other session — that is the point of it.
  const revoked = await revokeAllSessions(consumed.userId);
  await appendAudit({
    actorUserId: consumed.userId,
    action: 'auth.reset-password',
    area: 'Auth',
    summary: `Password reset — ${revoked} other session${revoked === 1 ? '' : 's'} signed out.`,
  });

  await createSession(consumed.userId);
  redirect('/home');
}

export async function verifyEmail(token: string): Promise<boolean> {
  const consumed = await consumeToken('verify_email', token);
  if (!consumed?.userId) return false;
  await db.update(users).set({ emailVerifiedAt: new Date(), status: 'active' }).where(eq(users.id, consumed.userId));
  await db.execute(sql`SELECT 1`);
  return true;
}
