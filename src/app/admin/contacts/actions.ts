'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { contactBindings, contactCards } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { appendAudit } from '@/lib/audit';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import type { FieldVisibility } from '@/lib/serialize';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function saveContact(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const label = field(form, 'label');
  if (!label) return { error: 'Give the card a label — “People and Payroll”, “IT”, whatever people call it.' };

  const visibility = (name: string): FieldVisibility => {
    const value = field(form, name);
    return value === 'managers' || value === 'admins' ? value : 'all';
  };

  const [row] = await db
    .insert(contactCards)
    .values({
      label,
      personName: field(form, 'personName') || null,
      roleTitle: field(form, 'roleTitle') || null,
      email: field(form, 'email') || null,
      phone: field(form, 'phone') || null,
      responseTime: field(form, 'responseTime') || null,
      note: field(form, 'note') || null,
      departmentId: field(form, 'departmentId') || null,
      locationId: field(form, 'locationId') || null,
      fieldVisibility: { email: visibility('emailVisibility'), phone: visibility('phoneVisibility') },
    })
    .returning({ id: contactCards.id });

  // The instance-wide fallback: the last link in the resolution chain.
  if (field(form, 'isDefault') === 'on') {
    await db.insert(contactBindings).values({ cardId: row!.id, targetType: 'instance', targetId: null, purpose: 'help' }).onConflictDoNothing();
  }

  await appendAudit({
    actorUserId: admin.id,
    action: 'contact.create',
    area: 'Setup',
    targetType: 'contact_card',
    targetId: row!.id,
    summary: `Contact card “${label}” saved — pages with nothing more specific now resolve to it.`,
  });

  revalidatePath('/admin/contacts');
  return { notice: `Saved. Pages with nothing more specific now resolve to “${label}”.` };
}

export async function removeContact(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const id = field(form, 'id');
  const [row] = await db
    .update(contactCards)
    .set({ archivedAt: new Date() })
    .where(and(eq(contactCards.id, id), isNull(contactCards.archivedAt)))
    .returning({ label: contactCards.label });
  if (!row) return { error: 'That card has already been removed.' };

  const message = `“${row.label}” is out of the chain. Pages that resolved to it now fall through to whatever sits behind it.`;
  await appendAudit({
    actorUserId: admin.id,
    action: 'contact.archive',
    area: 'Setup',
    targetType: 'contact_card',
    targetId: id,
    summary: message,
  });
  revalidatePath('/admin/contacts');
  return { notice: message };
}
