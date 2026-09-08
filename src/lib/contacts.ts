import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { contactBindings, contactCards } from '@/db/schema';
import { serializeContactCard, isEmptyCard, type PublicContactCard, type Viewer, type FieldVisibility } from '@/lib/serialize';

/**
 * The contact resolution chain: page → topic → section → the reader's own
 * department → the instance's default. The first card that resolves wins.
 *
 * An unfilled surface is hidden, never rendered as an empty card — so a card
 * with nothing the reader may see is dropped rather than shown blank.
 */

export type ContactTarget =
  | { kind: 'page'; id: string; topicId: string; sectionId: string }
  | { kind: 'section'; id: string }
  | { kind: 'none' };

export interface ResolvedContact {
  card: PublicContactCard;
  /** Which link in the chain answered. The employee UI does not show this;
   *  the admin's health checks do. */
  via: 'page' | 'topic' | 'section' | 'department' | 'default';
}

const SELECT = {
  id: contactCards.id,
  label: contactCards.label,
  personName: contactCards.personName,
  roleTitle: contactCards.roleTitle,
  email: contactCards.email,
  phone: contactCards.phone,
  responseTime: contactCards.responseTime,
  note: contactCards.note,
  fieldVisibility: contactCards.fieldVisibility,
  orgNodeId: contactCards.orgNodeId,
};

async function bound(targetType: string, targetId: string, purpose = 'help') {
  const rows = await db
    .select(SELECT)
    .from(contactBindings)
    .innerJoin(contactCards, eq(contactCards.id, contactBindings.cardId))
    .where(
      and(
        eq(contactBindings.targetType, targetType),
        eq(contactBindings.targetId, targetId),
        eq(contactBindings.purpose, purpose),
        isNull(contactCards.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function direct(cardId: string | null) {
  if (!cardId) return null;
  const rows = await db.select(SELECT).from(contactCards).where(and(eq(contactCards.id, cardId), isNull(contactCards.archivedAt))).limit(1);
  return rows[0] ?? null;
}

async function forDepartment(departmentId: string | null) {
  if (!departmentId) return null;
  const rows = await db
    .select(SELECT)
    .from(contactCards)
    .where(and(eq(contactCards.departmentId, departmentId), isNull(contactCards.archivedAt)))
    .limit(1);
  return rows[0] ?? null;
}

async function instanceDefault() {
  const rows = await db
    .select(SELECT)
    .from(contactBindings)
    .innerJoin(contactCards, eq(contactCards.id, contactBindings.cardId))
    .where(and(eq(contactBindings.targetType, 'instance'), isNull(contactCards.archivedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ResolveInput {
  pageId?: string | null;
  pageHelpCardId?: string | null;
  topicId?: string | null;
  topicHelpCardId?: string | null;
  sectionId?: string | null;
  sectionHelpCardId?: string | null;
  departmentId?: string | null;
  viewer: Viewer;
}

/** Walk the chain and return the first card with something to show. */
export async function resolveContact(input: ResolveInput): Promise<ResolvedContact | null> {
  const steps: [ResolvedContact['via'], () => Promise<Record<string, unknown> | null>][] = [
    ['page', async () => (await direct(input.pageHelpCardId ?? null)) ?? (input.pageId ? await bound('page', input.pageId) : null)],
    ['topic', async () => (await direct(input.topicHelpCardId ?? null)) ?? (input.topicId ? await bound('topic', input.topicId) : null)],
    [
      'section',
      async () => (await direct(input.sectionHelpCardId ?? null)) ?? (input.sectionId ? await bound('section', input.sectionId) : null),
    ],
    ['department', async () => await forDepartment(input.departmentId ?? null)],
    ['default', async () => await instanceDefault()],
  ];

  for (const [via, load] of steps) {
    const row = await load();
    if (!row) continue;
    const card = serializeContactCard(
      {
        id: row.id as string,
        label: row.label as string,
        personName: (row.personName ?? null) as string | null,
        roleTitle: (row.roleTitle ?? null) as string | null,
        email: (row.email ?? null) as string | null,
        phone: (row.phone ?? null) as string | null,
        responseTime: (row.responseTime ?? null) as string | null,
        note: (row.note ?? null) as string | null,
        fieldVisibility: (row.fieldVisibility ?? {}) as Record<string, FieldVisibility>,
        orgNodeId: (row.orgNodeId ?? null) as string | null,
      },
      input.viewer,
    );
    if (isEmptyCard(card)) continue;
    return { card, via };
  }
  return null;
}

/** The reader's own manager, resolved from the org chart rather than a tier. */
export async function resolveManager(userId: string, viewer: Viewer): Promise<PublicContactCard | null> {
  const rows = await db.execute<{
    id: string;
    display_name: string;
    role_title: string | null;
    work_email: string | null;
    work_phone: string | null;
    org_node_id: string;
  }>(sql`
    SELECT m.id AS org_node_id,
           mp.user_id AS id,
           mp.display_name,
           m.title AS role_title,
           mp.work_email,
           mp.work_phone
    FROM org_node n
    JOIN org_node m ON m.id = n.parent_id AND m.archived_at IS NULL
    JOIN employee_profile mp ON mp.user_id = m.user_id
    WHERE n.user_id = ${userId} AND n.archived_at IS NULL
    LIMIT 1
  `);
  const row = rows.rows[0];
  if (!row) return null;
  return serializeContactCard(
    {
      id: row.id,
      label: 'Your manager',
      personName: row.display_name,
      roleTitle: row.role_title,
      email: row.work_email,
      phone: row.work_phone,
      responseTime: null,
      note: null,
      fieldVisibility: {},
      orgNodeId: row.org_node_id,
    },
    viewer,
  );
}
