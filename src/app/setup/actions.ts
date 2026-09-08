'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/db/client';
import { instance, users } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { hashPassword, checkPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { isValidTimeZone } from '@/lib/access/dates';
import { needsFirstAdmin } from '@/lib/setup';
import { verifyMail } from '@/lib/mail';
import { requireAdmin } from '@/lib/auth/guards';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The first admin. Public exactly once — the moment an admin exists this
 * refuses, so a deployment cannot be claimed twice.
 */
export async function createFirstAdmin(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  if (!(await needsFirstAdmin())) {
    return { error: 'This deployment already has an administrator. Sign in instead.' };
  }

  const email = field(form, 'email').toLowerCase();
  const password = String(form.get('password') ?? '');
  const companyName = field(form, 'companyName');
  const timeZone = field(form, 'timeZone') || 'UTC';

  if (!email.includes('@')) return { error: 'That does not look like an email address.' };
  const problem = checkPassword(password, { email });
  if (problem) return { error: problem.message };
  if (!companyName) return { error: 'Give the company a display name — employees see it at the top of every screen.' };
  if (!isValidTimeZone(timeZone)) return { error: `“${timeZone}” is not a timezone this system knows.` };

  const userId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email,
        passwordHash: await hashPassword(password),
        status: 'active',
        isAdmin: true,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });

    await tx
      .insert(instance)
      .values({ id: 1, displayName: companyName, timeZone })
      .onConflictDoUpdate({ target: instance.id, set: { displayName: companyName, timeZone, updatedAt: new Date() } });

    return row!.id;
  });

  await createSession(userId);
  await appendAudit({
    actorUserId: userId,
    action: 'setup.first-admin',
    area: 'Setup',
    summary: `${companyName} set up — this account administers the instance.`,
  });

  redirect('/admin');
}

/** Company details. Blank fields stay hidden from employees, never empty cards. */
export async function saveCompanyDetails(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const timeZone = field(form, 'timeZone') || 'UTC';
  if (!isValidTimeZone(timeZone)) return { error: `“${timeZone}” is not a timezone this system knows.` };

  const values = {
    legalName: field(form, 'legalName') || null,
    displayName: field(form, 'displayName') || null,
    street: field(form, 'street') || null,
    suite: field(form, 'suite') || null,
    city: field(form, 'city') || null,
    region: field(form, 'region') || null,
    postalCode: field(form, 'postalCode') || null,
    country: field(form, 'country') || null,
    mainPhone: field(form, 'mainPhone') || null,
    enquiriesEmail: field(form, 'enquiriesEmail') || null,
    website: field(form, 'website') || null,
    firstContactName: field(form, 'firstContactName') || null,
    firstContactEmail: field(form, 'firstContactEmail') || null,
    firstContactPhone: field(form, 'firstContactPhone') || null,
    timeZone,
    sizeBand: field(form, 'sizeBand') || null,
    leaveYearStart: field(form, 'leaveYearStart') || null,
    updatedAt: new Date(),
  };

  await db
    .insert(instance)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: instance.id, set: values });

  await appendAudit({
    actorUserId: admin.id,
    action: 'setup.company-details',
    area: 'Setup',
    targetType: 'instance',
    summary: 'Company details saved — contacts and dates now resolve from them.',
  });

  return { notice: 'Company details saved — contacts and dates now resolve from them.' };
}

/** The mandatory test send. It says what failed, not that something failed. */
export async function testMail(_state: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }
  const result = await verifyMail();
  return result.ok
    ? { notice: 'The mail relay answered. Invitations and reset links will reach people.' }
    : { error: `The mail relay did not answer: ${result.reason}` };
}

export async function setAccent(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }
  const accent = field(form, 'accentColor');
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) return { error: 'Give the accent as a hex colour, like #0088b0.' };
  await db
    .update(instance)
    .set({ accentColor: accent || null, updatedAt: new Date() })
    .where(eq(instance.id, 1));
  await appendAudit({
    actorUserId: admin.id,
    action: 'setup.accent',
    area: 'Setup',
    summary: accent ? `Accent set to ${accent}.` : 'Accent reset to the default cyan.',
  });
  return { notice: accent ? 'Accent saved — it applies everywhere immediately.' : 'Back to the default cyan.' };
}
