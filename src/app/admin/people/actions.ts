'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { authTokens, employeeProfiles, orgNodes, sessions, tenureAnchors, users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { appendAudit } from '@/lib/audit';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { issueToken } from '@/lib/auth/tokens';
import { env } from '@/env';
import { sendMail } from '@/lib/mail';
import { revokeAllSessions } from '@/lib/auth/session';

export interface FormState {
  error?: string;
  notice?: string;
  /** An invite link is shown once, here, so an admin can hand it over directly. */
  link?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

async function guard(form: FormData) {
  const admin = await requireAdmin();
  await assertCsrf(field(form, CSRF_FIELD));
  return admin;
}

/** An invitation carries the dimensions the profile starts with. */
export async function createInvite(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const email = field(form, 'email').toLowerCase();
  if (email && !email.includes('@')) return { error: 'That does not look like an email address.' };

  const hireDate = field(form, 'hireDate');
  if (hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return { error: 'Give the start date as YYYY-MM-DD.' };

  const { token, expiresAt } = await issueToken({
    purpose: 'invite',
    email: email || null,
    createdBy: admin.id,
    payload: {
      departmentId: field(form, 'departmentId') || undefined,
      roleId: field(form, 'roleId') || undefined,
      employeeTypeId: field(form, 'employeeTypeId') || undefined,
      locationId: field(form, 'locationId') || undefined,
      hireDate: hireDate || undefined,
      isAdmin: field(form, 'isAdmin') === 'on',
    },
  });

  const link = `${env.APP_BASE_URL}/register?token=${token}`;

  if (email) {
    await sendMail({
      to: email,
      subject: 'Your handbook account',
      text: `Set up your handbook account here:\n\n${link}\n\nThe link works once and expires ${expiresAt.toDateString()}.`,
    });
  }

  await appendAudit({
    actorUserId: admin.id,
    action: 'invite.create',
    area: 'People',
    summary: email ? `Invitation issued to ${email.split('@')[1] ?? 'an address'}.` : 'An invitation link was generated.',
  });

  revalidatePath('/admin/people');
  return {
    notice: email
      ? 'Invitation sent. The link works once and expires in a fortnight — you can also hand this one over directly.'
      : 'Link generated. It works once and expires in a fortnight.',
    link,
  };
}

export async function revokeInvite(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const id = field(form, 'id');
  await db
    .update(authTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(authTokens.id, id), eq(authTokens.purpose, 'invite'), isNull(authTokens.consumedAt)));
  await appendAudit({ actorUserId: admin.id, action: 'invite.revoke', area: 'People', summary: 'An invitation was revoked before it was used.' });
  revalidatePath('/admin/people');
  return { notice: 'Revoked. That link no longer works.' };
}

/** Deactivation is a status. Acknowledgment rows are never cascaded away. */
export async function deactivatePerson(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const userId = field(form, 'userId');
  if (userId === admin.id) return { error: 'You cannot deactivate the account you are signed in with.' };

  const [row] = await db.update(users).set({ status: 'deactivated' }).where(eq(users.id, userId)).returning({ id: users.id });
  if (!row) return { error: 'That person no longer exists.' };
  const revoked = await revokeAllSessions(userId);

  const [profile] = await db
    .select({ name: employeeProfiles.displayName })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.userId, userId))
    .limit(1);

  const message = `${profile?.name ?? 'That account'} can no longer sign in, and ${revoked} session${revoked === 1 ? ' was' : 's were'} ended. What they acknowledged is kept.`;
  await appendAudit({
    actorUserId: admin.id,
    action: 'person.deactivate',
    area: 'People',
    targetType: 'user',
    targetId: userId,
    summary: message,
  });

  revalidatePath('/admin/people');
  return { notice: message };
}

export async function reactivatePerson(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const userId = field(form, 'userId');
  await db.update(users).set({ status: 'active' }).where(eq(users.id, userId));
  await appendAudit({
    actorUserId: admin.id,
    action: 'person.reactivate',
    area: 'People',
    targetType: 'user',
    targetId: userId,
    summary: 'That account can sign in again, and sees whatever their record routes to them.',
  });
  revalidatePath('/admin/people');
  return { notice: 'They can sign in again.' };
}

/** Every change to a reporting line is a hand-drawn override, and is audited. */
export async function setManager(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }

  const userId = field(form, 'userId');
  const managerUserId = field(form, 'managerUserId');
  if (!userId) return { error: 'Pick a person.' };
  if (userId === managerUserId) return { error: 'Nobody reports to themselves.' };

  const [node] = await db
    .insert(orgNodes)
    .values({ userId, lineOrigin: 'override' })
    .onConflictDoUpdate({ target: orgNodes.userId, set: { lineOrigin: 'override' } })
    .returning({ id: orgNodes.id });

  let parentId: string | null = null;
  if (managerUserId) {
    const [managerNode] = await db
      .insert(orgNodes)
      .values({ userId: managerUserId, lineOrigin: 'override' })
      .onConflictDoUpdate({ target: orgNodes.userId, set: { lineOrigin: orgNodes.lineOrigin } })
      .returning({ id: orgNodes.id });
    parentId = managerNode?.id ?? null;

    // A cycle would make the chart unwalkable; refuse rather than corrupt it.
    if (await wouldCycle(parentId, node!.id)) {
      return { error: 'That would make the reporting line loop back on itself.' };
    }
  }

  await db.update(orgNodes).set({ parentId, lineOrigin: 'override' }).where(eq(orgNodes.id, node!.id));

  const [person] = await db.select({ name: employeeProfiles.displayName }).from(employeeProfiles).where(eq(employeeProfiles.userId, userId)).limit(1);
  const [manager] = managerUserId
    ? await db.select({ name: employeeProfiles.displayName }).from(employeeProfiles).where(eq(employeeProfiles.userId, managerUserId)).limit(1)
    : [];

  const message = managerUserId
    ? `${person?.name ?? 'Someone'} now reports to ${manager?.name ?? 'someone'} — drawn by hand, not imported.`
    : `${person?.name ?? 'Someone'} sits at the top of their line now — drawn by hand, not imported.`;

  await appendAudit({
    actorUserId: admin.id,
    action: 'org.override',
    area: 'People',
    targetType: 'user',
    targetId: userId,
    summary: message,
  });

  revalidatePath('/admin/people');
  revalidatePath('/org');
  return { notice: message };
}

async function wouldCycle(startNodeId: string | null, targetNodeId: string): Promise<boolean> {
  let cursor = startNodeId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === targetNodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const [row] = await db.select({ parentId: orgNodes.parentId }).from(orgNodes).where(eq(orgNodes.id, cursor)).limit(1);
    cursor = row?.parentId ?? null;
  }
  return false;
}

export async function revokeOneSession(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const sessionId = field(form, 'sessionId');
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  await appendAudit({ actorUserId: admin.id, action: 'session.revoke', area: 'People', summary: 'A session was ended by an admin.' });
  revalidatePath('/admin/people');
  return { notice: 'Ended. That device has to sign in again.' };
}

/** Add a person directly, for the case where a CSV is overkill. */
export async function addPerson(_state: FormState, form: FormData): Promise<FormState> {
  let admin;
  try {
    admin = await guard(form);
  } catch {
    return { error: 'That request could not be verified.' };
  }

  const email = field(form, 'email').toLowerCase();
  const displayName = field(form, 'displayName');
  if (!email.includes('@')) return { error: 'That does not look like an email address.' };
  if (!displayName) return { error: 'Give the name their colleagues will see.' };

  const hireDate = field(form, 'hireDate');
  if (hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return { error: 'Give the start date as YYYY-MM-DD.' };

  const hours = field(form, 'hoursPerWeek');

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { error: 'Somebody with that address is already here.' };

  await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, status: 'invited' }).returning({ id: users.id });
    await tx.insert(employeeProfiles).values({
      userId: user!.id,
      displayName,
      departmentId: field(form, 'departmentId') || null,
      roleId: field(form, 'roleId') || null,
      employeeTypeId: field(form, 'employeeTypeId') || null,
      locationId: field(form, 'locationId') || null,
      hireDate: hireDate || null,
      hoursPerWeek: hours || null,
    });
    // hire_date is mirrored so the evaluator has one lookup path for anchors.
    if (hireDate) await tx.insert(tenureAnchors).values({ userId: user!.id, key: 'hire_date', date: hireDate });
    await tx.insert(orgNodes).values({ userId: user!.id, lineOrigin: 'override' }).onConflictDoNothing();
  });

  await appendAudit({
    actorUserId: admin.id,
    action: 'person.create',
    area: 'People',
    summary: `${displayName} added to the roster. They cannot sign in until an invitation is redeemed.`,
  });

  revalidatePath('/admin/people');
  return { notice: `${displayName} added. Send them an invitation when you are ready — they cannot sign in until they redeem one.` };
}
