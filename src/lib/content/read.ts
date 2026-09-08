import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { accessRules, blocks, pages, pageVersions, sections, topics } from '@/db/schema';
import { evaluate } from '@/lib/access/engine';
import type { AccessRule, Conditions, Decision, LockedVisibility, Node, Subject } from '@/lib/access/types';

/**
 * The read path. Every employee-facing read of content goes through here, and
 * every one of them is decided server-side, before render: a body the subject
 * may not see is never fetched into a payload and hidden in the browser.
 */

export interface VisiblePage {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  kind: string;
  requiresAcknowledgment: boolean;
  effectiveDate: string | null;
  decision: Decision;
}

export interface VisibleTopic {
  id: string;
  slug: string;
  title: string;
  lead: string | null;
  pages: VisiblePage[];
}

export interface VisibleSection {
  id: string;
  slug: string;
  title: string;
  lead: string | null;
  topics: VisibleTopic[];
}

type RuleRow = {
  id: string;
  targetType: string;
  targetId: string;
  effect: string;
  conditions: unknown;
  visibilityWhenLocked: string;
  priority: number;
};

function toRule(row: RuleRow): AccessRule {
  return {
    id: row.id,
    effect: row.effect === 'deny' ? 'deny' : 'allow',
    conditions: (row.conditions ?? {}) as Conditions,
    visibilityWhenLocked: (['hidden', 'teaser', 'preview'] as const).includes(row.visibilityWhenLocked as LockedVisibility)
      ? (row.visibilityWhenLocked as LockedVisibility)
      : 'teaser',
    priority: row.priority,
  };
}

/** All live rules, keyed by `${targetType}:${targetId}`. One query per read. */
export async function loadRuleIndex(): Promise<Map<string, AccessRule[]>> {
  const rows = await db
    .select({
      id: accessRules.id,
      targetType: accessRules.targetType,
      targetId: accessRules.targetId,
      effect: accessRules.effect,
      conditions: accessRules.conditions,
      visibilityWhenLocked: accessRules.visibilityWhenLocked,
      priority: accessRules.priority,
    })
    .from(accessRules)
    .where(isNull(accessRules.archivedAt));

  const index = new Map<string, AccessRule[]>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    const list = index.get(key);
    if (list) list.push(toRule(row));
    else index.set(key, [toRule(row)]);
  }
  return index;
}

function node(index: Map<string, AccessRule[]>, type: Node['type'], id: string): Node {
  return { id, type, rules: index.get(`${type}:${id}`) ?? [] };
}

/** The resolved ancestor chain, root-first, for one page. */
export function chainFor(
  index: Map<string, AccessRule[]>,
  ids: { sectionId: string; topicId: string; pageId: string },
): Node[] {
  return [
    node(index, 'section', ids.sectionId),
    node(index, 'topic', ids.topicId),
    node(index, 'page', ids.pageId),
  ];
}

/**
 * Published navigation for one subject.
 *
 * A locked page stays in place with its title, unlock date and teaser — locked
 * is not absent, and knowing what is coming is the point. A hidden page is
 * gone. A topic with nothing left is dropped, and a section with no published
 * pages is hidden from navigation entirely.
 */
export async function loadNavigation(subject: Subject, at: Date = new Date()): Promise<VisibleSection[]> {
  const [rows, index] = await Promise.all([
    db
      .select({
        sectionId: sections.id,
        sectionSlug: sections.slug,
        sectionTitle: sections.title,
        sectionLead: sections.lead,
        sectionSort: sections.sortKey,
        topicId: topics.id,
        topicSlug: topics.slug,
        topicTitle: topics.title,
        topicLead: topics.lead,
        topicSort: topics.sortKey,
        pageId: pages.id,
        pageSlug: pages.slug,
        pageTitle: pages.title,
        pageTeaser: pages.teaser,
        pageKind: pages.kind,
        pageSort: pages.sortKey,
        requiresAcknowledgment: pages.requiresAcknowledgment,
        effectiveDate: pages.effectiveDate,
      })
      .from(pages)
      .innerJoin(topics, eq(topics.id, pages.topicId))
      .innerJoin(sections, eq(sections.id, topics.sectionId))
      .where(
        and(
          eq(pages.state, 'published'),
          isNull(pages.archivedAt),
          eq(topics.state, 'published'),
          isNull(topics.archivedAt),
          eq(sections.state, 'published'),
          isNull(sections.archivedAt),
        ),
      )
      .orderBy(asc(sections.sortKey), asc(topics.sortKey), asc(pages.sortKey)),
    loadRuleIndex(),
  ]);

  const bySection = new Map<string, VisibleSection>();
  const byTopic = new Map<string, VisibleTopic>();

  for (const row of rows) {
    const decision = evaluate(
      subject,
      chainFor(index, { sectionId: row.sectionId, topicId: row.topicId, pageId: row.pageId }),
      at,
    );
    if (!decision.allowed && decision.visibility === 'hidden') continue;

    let section = bySection.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        slug: row.sectionSlug,
        title: row.sectionTitle,
        lead: row.sectionLead,
        topics: [],
      };
      bySection.set(row.sectionId, section);
    }

    let topic = byTopic.get(row.topicId);
    if (!topic) {
      topic = { id: row.topicId, slug: row.topicSlug, title: row.topicTitle, lead: row.topicLead, pages: [] };
      byTopic.set(row.topicId, topic);
      section.topics.push(topic);
    }

    topic.pages.push({
      id: row.pageId,
      slug: row.pageSlug,
      title: row.pageTitle,
      teaser: row.pageTeaser,
      kind: row.pageKind,
      requiresAcknowledgment: row.requiresAcknowledgment,
      effectiveDate: row.effectiveDate,
      decision,
    });
  }

  return [...bySection.values()];
}

export interface PageRead {
  state: 'full' | 'locked';
  page: {
    id: string;
    slug: string;
    title: string;
    teaser: string | null;
    kind: string;
    requiresAcknowledgment: boolean;
    effectiveDate: string | null;
    topicId: string;
    topicTitle: string;
    topicSlug: string;
    sectionId: string;
    sectionTitle: string;
    sectionSlug: string;
    helpContactCardId: string | null;
    topicHelpContactCardId: string | null;
    sectionHelpContactCardId: string | null;
  };
  decision: Decision;
  blocks: { id: string; kind: string; data: Record<string, unknown>; bylineKind: string | null; publishedAt: Date | null }[];
  version: { id: string; versionNo: number; contentHash: string; publishedAt: Date } | null;
}

/**
 * One page for one subject. Returns null when the page is not routable for
 * them — an unpublished page and a denied page are the same 404, deliberately.
 * A locked page returns without its blocks; the body never leaves the server.
 */
export async function loadPage(slug: string, subject: Subject, at: Date = new Date()): Promise<PageRead | null> {
  const [row] = await db
    .select({
      id: pages.id,
      slug: pages.slug,
      title: pages.title,
      teaser: pages.teaser,
      kind: pages.kind,
      requiresAcknowledgment: pages.requiresAcknowledgment,
      effectiveDate: pages.effectiveDate,
      helpContactCardId: pages.helpContactCardId,
      topicId: topics.id,
      topicTitle: topics.title,
      topicSlug: topics.slug,
      topicHelpContactCardId: topics.helpContactCardId,
      sectionId: sections.id,
      sectionTitle: sections.title,
      sectionSlug: sections.slug,
      sectionHelpContactCardId: sections.helpContactCardId,
    })
    .from(pages)
    .innerJoin(topics, eq(topics.id, pages.topicId))
    .innerJoin(sections, eq(sections.id, topics.sectionId))
    .where(
      and(
        eq(pages.slug, slug),
        eq(pages.state, 'published'),
        isNull(pages.archivedAt),
        eq(topics.state, 'published'),
        isNull(topics.archivedAt),
        eq(sections.state, 'published'),
        isNull(sections.archivedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const index = await loadRuleIndex();
  const decision = evaluate(
    subject,
    chainFor(index, { sectionId: row.sectionId, topicId: row.topicId, pageId: row.id }),
    at,
  );

  if (!decision.allowed && decision.visibility === 'hidden') return null;

  if (!decision.allowed) {
    // Locked: title, unlock date and the one-line teaser. No blocks are read,
    // and no version identity is issued — there is nothing here to acknowledge
    // and nothing about the body to confirm.
    return { state: 'locked', page: row, decision, blocks: [], version: null };
  }

  const version = await latestVersion(row.id);

  const blockRows = await db
    .select({
      id: blocks.id,
      kind: blocks.kind,
      data: blocks.data,
      bylineKind: blocks.bylineKind,
      publishedAt: blocks.publishedAt,
    })
    .from(blocks)
    .where(and(eq(blocks.pageId, row.id), isNull(blocks.archivedAt)))
    .orderBy(asc(blocks.sortKey));

  return {
    state: 'full',
    page: row,
    decision,
    // A summary block is draft until an admin publishes it; an unpublished one
    // is absent from the employee view rather than shown as an empty card.
    blocks: blockRows.filter((b) => b.kind !== 'summary' || b.publishedAt !== null),
    version,
  };
}

export async function latestVersion(pageId: string) {
  const [version] = await db
    .select({
      id: pageVersions.id,
      versionNo: pageVersions.versionNo,
      contentHash: pageVersions.contentHash,
      publishedAt: pageVersions.publishedAt,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.versionNo))
    .limit(1);
  return version ?? null;
}

/** Pages the subject may fully read, for the acknowledgment and search paths. */
export async function readablePageIds(subject: Subject, at: Date = new Date()): Promise<Set<string>> {
  const nav = await loadNavigation(subject, at);
  const ids = new Set<string>();
  for (const section of nav) {
    for (const topic of section.topics) {
      for (const page of topic.pages) {
        if (page.decision.allowed) ids.add(page.id);
      }
    }
  }
  return ids;
}

export async function pageIdsBySlug(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await db.select({ id: pages.id, slug: pages.slug }).from(pages).where(inArray(pages.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r.id]));
}
