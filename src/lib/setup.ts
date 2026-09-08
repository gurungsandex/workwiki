import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  accessRules,
  authTokens,
  contactCards,
  departments,
  employeeTypes,
  instance,
  locations,
  pages,
  roles,
  sections,
  users,
} from '@/db/schema';

/**
 * The setup checklist is derived from what exists in the instance — never from
 * a stored step number. An admin who abandons setup halfway and comes back a
 * week later sees the truth, not where they left off.
 */

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** What to do next, in the product's own voice. Never generic. */
  hint: string;
  href: string;
}

export interface SetupState {
  hasAdmin: boolean;
  hasInstance: boolean;
  companyFieldsFilled: number;
  companyFieldsRequired: number;
  checklist: ChecklistItem[];
  complete: boolean;
}

const REQUIRED_COMPANY_FIELDS = ['displayName', 'legalName', 'city', 'country', 'enquiriesEmail'] as const;

export async function setupState(): Promise<SetupState> {
  const [[adminRow], [instanceRow]] = await Promise.all([
    db.select({ n: count() }).from(users).where(and(eq(users.isAdmin, true), isNull(users.archivedAt))),
    db.select().from(instance).limit(1),
  ]);

  const [
    [departmentCount],
    [locationCount],
    [typeCount],
    [roleCount],
    [sectionCount],
    [publishedPageCount],
    [draftPageCount],
    [ruleCount],
    [contactCount],
    [inviteCount],
    [peopleCount],
  ] = await Promise.all([
    db.select({ n: count() }).from(departments).where(isNull(departments.archivedAt)),
    db.select({ n: count() }).from(locations).where(isNull(locations.archivedAt)),
    db.select({ n: count() }).from(employeeTypes).where(isNull(employeeTypes.archivedAt)),
    db.select({ n: count() }).from(roles).where(isNull(roles.archivedAt)),
    db.select({ n: count() }).from(sections).where(isNull(sections.archivedAt)),
    db.select({ n: count() }).from(pages).where(and(eq(pages.state, 'published'), isNull(pages.archivedAt))),
    db.select({ n: count() }).from(pages).where(and(eq(pages.state, 'draft'), isNull(pages.archivedAt))),
    db.select({ n: count() }).from(accessRules).where(isNull(accessRules.archivedAt)),
    db.select({ n: count() }).from(contactCards).where(isNull(contactCards.archivedAt)),
    db.select({ n: count() }).from(authTokens).where(eq(authTokens.purpose, 'invite')),
    db.select({ n: count() }).from(users).where(and(eq(users.isAdmin, false), isNull(users.archivedAt))),
  ]);

  const filled = instanceRow
    ? REQUIRED_COMPANY_FIELDS.filter((field) => String(instanceRow[field] ?? '').trim().length > 0).length
    : 0;

  const checklist: ChecklistItem[] = [
    {
      key: 'company',
      label: 'The company itself',
      done: filled === REQUIRED_COMPANY_FIELDS.length,
      hint: `${filled} of ${REQUIRED_COMPANY_FIELDS.length} required details filled. The rest of setup does not wait for them.`,
      href: '/admin/setup',
    },
    {
      key: 'structure',
      label: 'Departments, sites, roles and employee types',
      done: departmentCount!.n > 0 && locationCount!.n > 0 && typeCount!.n > 0,
      hint:
        departmentCount!.n === 0
          ? 'Nothing here yet. Access rules have nothing to route by until a department and a site exist.'
          : `${departmentCount!.n} department${departmentCount!.n === 1 ? '' : 's'}, ${roleCount!.n} role${roleCount!.n === 1 ? '' : 's'}, ${locationCount!.n} site${locationCount!.n === 1 ? '' : 's'}.`,
      href: '/admin/structure',
    },
    {
      key: 'content',
      label: 'Something written down',
      done: sectionCount!.n > 0 && (publishedPageCount!.n > 0 || draftPageCount!.n > 0),
      hint:
        draftPageCount!.n > 0
          ? `${draftPageCount!.n} draft${draftPageCount!.n === 1 ? '' : 's'} waiting to be published.`
          : 'Nothing written yet. One published page is enough to be useful.',
      href: '/admin/content',
    },
    {
      key: 'contacts',
      label: 'Who to ask',
      done: contactCount!.n > 0,
      hint:
        contactCount!.n === 0
          ? 'No contact card yet. Every page falls back to this one, so it is worth doing first.'
          : `${contactCount!.n} contact card${contactCount!.n === 1 ? '' : 's'}.`,
      href: '/admin/contacts',
    },
    {
      key: 'access',
      label: 'Who sees what',
      done: ruleCount!.n > 0,
      hint:
        ruleCount!.n === 0
          ? 'No rules yet, so everything published reaches everyone. That may be right — decide it deliberately.'
          : `${ruleCount!.n} rule${ruleCount!.n === 1 ? '' : 's'} in place.`,
      href: '/admin/access',
    },
    {
      key: 'publish',
      label: 'Published, so employees can read it',
      done: publishedPageCount!.n > 0,
      hint:
        publishedPageCount!.n === 0
          ? 'Nothing published. Drafts are invisible to employees, by design.'
          : `${publishedPageCount!.n} page${publishedPageCount!.n === 1 ? '' : 's'} live.`,
      href: '/admin/content',
    },
    {
      key: 'people',
      label: 'People invited',
      done: peopleCount!.n > 0 || inviteCount!.n > 0,
      hint:
        peopleCount!.n === 0 && inviteCount!.n === 0
          ? 'Only you so far — generate an invite link.'
          : `${peopleCount!.n} employee${peopleCount!.n === 1 ? '' : 's'}, ${inviteCount!.n} invitation${inviteCount!.n === 1 ? '' : 's'} issued.`,
      href: '/admin/people',
    },
  ];

  return {
    hasAdmin: (adminRow?.n ?? 0) > 0,
    hasInstance: Boolean(instanceRow),
    companyFieldsFilled: filled,
    companyFieldsRequired: REQUIRED_COMPANY_FIELDS.length,
    checklist,
    complete: checklist.every((item) => item.done),
  };
}

/** True before the first admin exists — the only moment /setup is public. */
export async function needsFirstAdmin(): Promise<boolean> {
  try {
    const [row] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM "user" WHERE is_admin AND archived_at IS NULL`,
    ).then((r) => r.rows as { n: number }[]);
    return (row?.n ?? 0) === 0;
  } catch {
    return false;
  }
}
