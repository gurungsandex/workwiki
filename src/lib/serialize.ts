import type { Decision } from '@/lib/access/types';

/**
 * The single place employee-facing responses are built.
 *
 * Personal contact details, hire dates and eligibility status are the sensitive
 * set. Field-level visibility is enforced here rather than at each route, so no
 * route can leak a mobile number by forgetting a filter (spec §11, "PII").
 */

export type Viewer = 'employee' | 'manager' | 'admin';
export type FieldVisibility = 'all' | 'managers' | 'admins';

const RANK: Record<Viewer, number> = { employee: 0, manager: 1, admin: 2 };
const REQUIRED: Record<FieldVisibility, number> = { all: 0, managers: 1, admins: 2 };

export function maySeeField(viewer: Viewer, visibility: FieldVisibility | undefined): boolean {
  return RANK[viewer] >= REQUIRED[visibility ?? 'all'];
}

export interface ContactCardRow {
  id: string;
  label: string;
  personName: string | null;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  responseTime: string | null;
  note: string | null;
  fieldVisibility: Record<string, FieldVisibility>;
  orgNodeId: string | null;
}

export interface PublicContactCard {
  id: string;
  label: string;
  personName: string | null;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  responseTime: string | null;
  note: string | null;
  orgNodeId: string | null;
}

/**
 * A field the viewer may not see is absent, not null-with-a-label: an
 * employee-facing gap is hidden, never rendered as an empty card.
 */
export function serializeContactCard(card: ContactCardRow, viewer: Viewer): PublicContactCard {
  const field = <K extends keyof ContactCardRow>(key: K): ContactCardRow[K] | null =>
    maySeeField(viewer, card.fieldVisibility[key as string]) ? card[key] : null;

  return {
    id: card.id,
    label: card.label,
    personName: field('personName'),
    roleTitle: field('roleTitle'),
    email: field('email'),
    phone: field('phone'),
    responseTime: card.responseTime,
    note: card.note,
    orgNodeId: card.orgNodeId,
  };
}

/** True when a card has nothing left to show and should be omitted entirely. */
export function isEmptyCard(card: PublicContactCard): boolean {
  return !card.personName && !card.roleTitle && !card.email && !card.phone;
}

export interface PublicPageBody {
  id: string;
  slug: string;
  title: string;
  blocks: unknown[];
}

export interface PublicPageTeaser {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  unlockAt: string | null;
}

/**
 * The serialiser that decides whether a body leaves the server at all. A locked
 * page yields the title, the unlock date and one line — never the blocks, never
 * a partial body the client is trusted to hide.
 */
export function serializePage(
  page: { id: string; slug: string; title: string; teaser: string | null },
  blocks: unknown[],
  decision: Decision,
): { state: 'full'; page: PublicPageBody } | { state: 'locked'; page: PublicPageTeaser } | { state: 'hidden' } {
  if (decision.allowed) {
    return { state: 'full', page: { id: page.id, slug: page.slug, title: page.title, blocks } };
  }
  if (decision.visibility === 'hidden' || decision.unlockAt === null) return { state: 'hidden' };
  return {
    state: 'locked',
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      teaser: page.teaser,
      unlockAt: decision.unlockAt.toISOString(),
    },
  };
}
