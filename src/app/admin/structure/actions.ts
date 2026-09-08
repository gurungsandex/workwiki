'use server';

import { and, count, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { departments, employeeProfiles, employeeTypes, locations, roles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { appendAudit } from '@/lib/audit';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { slugify } from '@/lib/content/mutations';
import { isValidTimeZone } from '@/lib/access/dates';

/**
 * Departments, roles, employee types and locations are rows an admin
 * populates — never enums, never a TypeScript union, never a migration. This
 * module is the only place they are written.
 */

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

type Dimension = 'department' | 'role' | 'employee_type' | 'location';

const TABLES = {
  department: departments,
  role: roles,
  employee_type: employeeTypes,
  location: locations,
} as const;

async function freeSlug(dimension: Dimension, name: string): Promise<string> {
  const table = TABLES[dimension];
  const base = slugify(name);
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.slug, candidate)).limit(1);
    if (!existing) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function addDimension(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const dimension = field(form, 'dimension') as Dimension;
  if (!(dimension in TABLES)) return { error: 'That is not something this instance keeps a list of.' };

  const name = field(form, 'name');
  if (!name) return { error: 'Give it a name — the one your people already use for it.' };

  const slug = await freeSlug(dimension, name);

  if (dimension === 'department') {
    await db.insert(departments).values({ name, slug });
  } else if (dimension === 'role') {
    const departmentId = field(form, 'departmentId') || null;
    await db.insert(roles).values({ name, slug, departmentId });
  } else if (dimension === 'employee_type') {
    const kind = field(form, 'kind') || 'other';
    await db.insert(employeeTypes).values({ name, slug, kind });
  } else {
    const timeZone = field(form, 'timeZone') || null;
    if (timeZone && !isValidTimeZone(timeZone)) return { error: `“${timeZone}” is not a timezone this system knows.` };
    await db.insert(locations).values({
      name,
      slug,
      region: field(form, 'region') || null,
      country: field(form, 'country') || null,
      timeZone,
    });
  }

  await appendAudit({
    actorUserId: admin.id,
    action: `${dimension}.create`,
    area: 'Setup',
    targetType: dimension,
    summary: `“${name}” added — access rules can route by it from now on.`,
    after: { name, slug },
  });

  revalidatePath('/admin/structure');
  return { notice: `“${name}” added — access rules can route by it from now on.` };
}

export async function renameDimension(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }

  const dimension = field(form, 'dimension') as Dimension;
  const id = field(form, 'id');
  const name = field(form, 'name');
  if (!(dimension in TABLES) || !id || !name) return { error: 'Nothing to rename.' };

  const table = TABLES[dimension];
  const [before] = await db.select({ name: table.name }).from(table).where(eq(table.id, id)).limit(1);
  // The slug is stable across a rename: rules and links keep pointing at it.
  await db.update(table).set({ name }).where(eq(table.id, id));

  await appendAudit({
    actorUserId: admin.id,
    action: `${dimension}.rename`,
    area: 'Setup',
    targetType: dimension,
    targetId: id,
    summary: `“${before?.name ?? '—'}” is now called “${name}”. Every rule that named it still names it.`,
  });

  revalidatePath('/admin/structure');
  return { notice: `Renamed. Every rule that named it still names it.` };
}

/**
 * Removal is soft, and the message says what widened or moved — never what was
 * deleted. People keep their record; the rules that named it stop narrowing.
 */
export async function removeDimension(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }

  const dimension = field(form, 'dimension') as Dimension;
  const id = field(form, 'id');
  if (!(dimension in TABLES) || !id) return { error: 'Nothing to remove.' };

  const table = TABLES[dimension];
  const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) return { error: 'That has already been removed.' };

  const column =
    dimension === 'department'
      ? employeeProfiles.departmentId
      : dimension === 'role'
        ? employeeProfiles.roleId
        : dimension === 'employee_type'
          ? employeeProfiles.employeeTypeId
          : employeeProfiles.locationId;

  const [affected] = await db.select({ n: count() }).from(employeeProfiles).where(eq(column, id));
  await db.update(table).set({ archivedAt: new Date() }).where(and(eq(table.id, id), isNull(table.archivedAt)));

  const people = affected?.n ?? 0;
  const message =
    people === 0
      ? `“${row.name}” is out of the lists. Nothing was routed by it, so nothing changed for anyone.`
      : `“${row.name}” is out of the lists. ${people} ${people === 1 ? 'person keeps' : 'people keep'} the record, and any rule that narrowed to it now reaches wider.`;

  await appendAudit({
    actorUserId: admin.id,
    action: `${dimension}.archive`,
    area: 'Setup',
    targetType: dimension,
    targetId: id,
    summary: message,
  });

  revalidatePath('/admin/structure');
  return { notice: message };
}

export async function restoreDimension(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const dimension = field(form, 'dimension') as Dimension;
  const id = field(form, 'id');
  if (!(dimension in TABLES) || !id) return { error: 'Nothing to restore.' };
  const table = TABLES[dimension];
  const [row] = await db.update(table).set({ archivedAt: null }).where(eq(table.id, id)).returning({ name: table.name });
  await appendAudit({
    actorUserId: admin.id,
    action: `${dimension}.restore`,
    area: 'Setup',
    targetType: dimension,
    targetId: id,
    summary: `“${row?.name ?? '—'}” is back in the lists, and rules that named it narrow again.`,
  });
  revalidatePath('/admin/structure');
  return { notice: `“${row?.name ?? '—'}” is back in the lists, and rules that named it narrow again.` };
}
