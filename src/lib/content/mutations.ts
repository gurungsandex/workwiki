import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { blocks, pages, pageVersions, sections, topics } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { contentHash } from '@/lib/crypto';
import { keyBetween } from '@/lib/sort-key';
import { blockText, validateBlock } from './blocks';

/**
 * Content lifecycle: draft → published → archived, and back by restore.
 *
 * Two rules are enforced here rather than asked for:
 *  - Deletes are soft. Nothing in this module issues a DELETE except `purge`,
 *    which is a separate, explicit, audited action.
 *  - Publishing snapshots the page into `page_version` and stamps a content
 *    hash. Acknowledgments point at that row, never at the live page, so an
 *    edit can never retroactively change what somebody attested to.
 */

export class ContentError extends Error {}

export type ContentKind = 'section' | 'topic' | 'page';

export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return base || 'untitled';
}

/** Slugs are unique per kind; a collision gets a numeric suffix, never a crash. */
export async function uniqueSlug(kind: ContentKind, title: string): Promise<string> {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const base = slugify(title);
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.slug, candidate)).limit(1);
    if (!existing) return candidate;
  }
  throw new ContentError('Could not find a free address for that title.');
}

async function nextSortKey(kind: ContentKind, parentId: string | null): Promise<string> {
  if (kind === 'section') {
    const [last] = await db.select({ sortKey: sections.sortKey }).from(sections).orderBy(desc(sections.sortKey)).limit(1);
    return keyBetween(last?.sortKey ?? null, null);
  }
  if (kind === 'topic') {
    const [last] = await db
      .select({ sortKey: topics.sortKey })
      .from(topics)
      .where(eq(topics.sectionId, parentId!))
      .orderBy(desc(topics.sortKey))
      .limit(1);
    return keyBetween(last?.sortKey ?? null, null);
  }
  const [last] = await db
    .select({ sortKey: pages.sortKey })
    .from(pages)
    .where(eq(pages.topicId, parentId!))
    .orderBy(desc(pages.sortKey))
    .limit(1);
  return keyBetween(last?.sortKey ?? null, null);
}

export async function createSection(input: { title: string; lead?: string | null; actorUserId: string; origin?: string }) {
  const [row] = await db
    .insert(sections)
    .values({
      title: input.title,
      slug: await uniqueSlug('section', input.title),
      lead: input.lead ?? null,
      sortKey: await nextSortKey('section', null),
      origin: input.origin ?? 'admin',
    })
    .returning();
  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'section.create',
    area: 'Content',
    targetType: 'section',
    targetId: row!.id,
    summary: `Section “${input.title}” created — it stays a draft until you publish it.`,
    after: { title: input.title },
  });
  return row!;
}

export async function createTopic(input: { sectionId: string; title: string; lead?: string | null; actorUserId: string }) {
  const [row] = await db
    .insert(topics)
    .values({
      sectionId: input.sectionId,
      title: input.title,
      slug: await uniqueSlug('topic', input.title),
      lead: input.lead ?? null,
      sortKey: await nextSortKey('topic', input.sectionId),
    })
    .returning();
  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'topic.create',
    area: 'Content',
    targetType: 'topic',
    targetId: row!.id,
    summary: `Topic “${input.title}” created.`,
    after: { title: input.title },
  });
  return row!;
}

export async function createPage(input: {
  topicId: string;
  title: string;
  teaser?: string | null;
  kind?: 'page' | 'statutory_posting';
  requiresAcknowledgment?: boolean;
  actorUserId: string;
}) {
  const [row] = await db
    .insert(pages)
    .values({
      topicId: input.topicId,
      title: input.title,
      slug: await uniqueSlug('page', input.title),
      teaser: input.teaser ?? null,
      kind: input.kind ?? 'page',
      requiresAcknowledgment: input.requiresAcknowledgment ?? false,
      sortKey: await nextSortKey('page', input.topicId),
    })
    .returning();
  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'page.create',
    area: 'Content',
    targetType: 'page',
    targetId: row!.id,
    summary: `Page “${input.title}” created — a draft, not visible to anyone yet.`,
    after: { title: input.title },
  });
  return row!;
}

export async function upsertBlock(input: {
  pageId: string;
  blockId?: string;
  kind: string;
  data: unknown;
  sourceBlockId?: string | null;
  sourceFileId?: string | null;
  sourceUrl?: string | null;
  actorUserId: string;
}) {
  const validated = validateBlock(input.kind, input.data);
  if (!validated.ok) throw new ContentError(validated.problem.message);

  if (input.blockId) {
    const [row] = await db
      .update(blocks)
      .set({ data: validated.data, updatedAt: new Date() })
      .where(and(eq(blocks.id, input.blockId), eq(blocks.pageId, input.pageId)))
      .returning();
    if (!row) throw new ContentError('That block is not on this page.');
    await refreshSearchText(input.pageId);
    return row;
  }

  const [last] = await db
    .select({ sortKey: blocks.sortKey })
    .from(blocks)
    .where(eq(blocks.pageId, input.pageId))
    .orderBy(desc(blocks.sortKey))
    .limit(1);

  const [row] = await db
    .insert(blocks)
    .values({
      pageId: input.pageId,
      kind: input.kind,
      data: validated.data,
      sortKey: keyBetween(last?.sortKey ?? null, null),
      sourceBlockId: input.sourceBlockId ?? null,
      sourceFileId: input.sourceFileId ?? null,
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning();
  await refreshSearchText(input.pageId);
  return row!;
}

/**
 * Publish a summary block. A summary may be *drafted* from source files, but it
 * must be hand-edited, and it stays unpublished until an admin publishes it —
 * which stamps a byline. A required statutory posting is never summarised by
 * the platform: the admin confirms the source, and that is a different byline.
 */
export async function publishBlock(input: { blockId: string; actorUserId: string }) {
  const [block] = await db.select().from(blocks).where(eq(blocks.id, input.blockId)).limit(1);
  if (!block) throw new ContentError('That block no longer exists.');

  const [page] = await db.select({ kind: pages.kind, title: pages.title }).from(pages).where(eq(pages.id, block.pageId)).limit(1);
  if (!page) throw new ContentError('That page no longer exists.');

  if (page.kind === 'statutory_posting' && block.kind === 'summary') {
    throw new ContentError(
      'A required posting is not summarised by this platform. Confirm the source instead — that is what employees see.',
    );
  }

  const bylineKind = page.kind === 'statutory_posting' ? 'confirmed' : 'summarised';
  const [row] = await db
    .update(blocks)
    .set({ publishedAt: new Date(), publishedBy: input.actorUserId, bylineKind, summaryStale: false })
    .where(eq(blocks.id, input.blockId))
    .returning();

  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'block.publish',
    area: 'Content',
    targetType: 'block',
    targetId: input.blockId,
    summary:
      bylineKind === 'confirmed'
        ? `Source confirmed on “${page.title}” — employees now see it with your name against the confirmation.`
        : `Summary published on “${page.title}” — employees now see it with your name against it.`,
  });
  return row!;
}

/** Confirm a statutory source. Produces the other byline, never a summary. */
export async function confirmStatutorySource(input: { blockId: string; actorUserId: string }) {
  const [row] = await db
    .update(blocks)
    .set({ publishedAt: new Date(), publishedBy: input.actorUserId, bylineKind: 'confirmed' })
    .where(eq(blocks.id, input.blockId))
    .returning();
  if (!row) throw new ContentError('That block no longer exists.');
  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'block.confirm',
    area: 'Documents',
    targetType: 'block',
    targetId: input.blockId,
    summary: 'Source confirmed — the posting now resolves to employees with the confirmation byline.',
  });
  return row;
}

/**
 * Publish a page: snapshot the blocks, hash them, bump the version number.
 * Publishing a new version re-triggers acknowledgment for everyone in scope,
 * because acknowledgments are per version and the new one has no rows yet.
 */
export async function publishPage(input: { pageId: string; actorUserId: string; effectiveDate?: string | null }) {
  const [page] = await db.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
  if (!page) throw new ContentError('That page no longer exists.');
  if (page.archivedAt) throw new ContentError('That page is in the archive. Restore it before publishing.');

  const blockRows = await db
    .select({ id: blocks.id, kind: blocks.kind, data: blocks.data, sortKey: blocks.sortKey, publishedAt: blocks.publishedAt })
    .from(blocks)
    .where(and(eq(blocks.pageId, input.pageId), isNull(blocks.archivedAt)))
    .orderBy(asc(blocks.sortKey));

  const visible = blockRows.filter((b) => b.kind !== 'summary' || b.publishedAt !== null);
  if (visible.length === 0) {
    throw new ContentError('This page has no blocks yet. Add something before publishing it.');
  }

  const snapshot = {
    title: page.title,
    teaser: page.teaser,
    blocks: visible.map((b) => ({ kind: b.kind, data: b.data })),
  };
  const hash = contentHash(snapshot);

  const [previous] = await db
    .select({ versionNo: pageVersions.versionNo, contentHash: pageVersions.contentHash })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, input.pageId))
    .orderBy(desc(pageVersions.versionNo))
    .limit(1);

  if (previous?.contentHash === hash && page.state === 'published') {
    return { version: null, unchanged: true as const };
  }

  const [version] = await db
    .insert(pageVersions)
    .values({
      pageId: input.pageId,
      versionNo: (previous?.versionNo ?? 0) + 1,
      snapshot,
      contentHash: hash,
      effectiveDate: input.effectiveDate ?? page.effectiveDate ?? null,
      publishedBy: input.actorUserId,
    })
    .returning();

  await db.update(pages).set({ state: 'published', updatedAt: new Date() }).where(eq(pages.id, input.pageId));
  await refreshSearchText(input.pageId);

  await appendAudit({
    actorUserId: input.actorUserId,
    action: 'page.publish',
    area: 'Content',
    targetType: 'page',
    targetId: input.pageId,
    summary:
      version!.versionNo === 1
        ? `“${page.title}” published — it now resolves for everyone your access rules reach.`
        : `“${page.title}” published as version ${version!.versionNo} — anyone who acknowledged version ${version!.versionNo - 1} is asked again.`,
  });

  return { version: version!, unchanged: false as const };
}

export async function unpublish(kind: ContentKind, id: string, actorUserId: string) {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const [row] = await db.update(table).set({ state: 'draft', updatedAt: new Date() }).where(eq(table.id, id)).returning();
  if (!row) throw new ContentError('That item no longer exists.');
  await appendAudit({
    actorUserId,
    action: `${kind}.unpublish`,
    area: 'Content',
    targetType: kind,
    targetId: id,
    summary: `“${row.title}” is a draft again — it no longer resolves for employees. Nothing was deleted.`,
  });
  return row;
}

export async function publishContainer(kind: 'section' | 'topic', id: string, actorUserId: string) {
  const table = kind === 'section' ? sections : topics;
  const [row] = await db.update(table).set({ state: 'published', updatedAt: new Date() }).where(eq(table.id, id)).returning();
  if (!row) throw new ContentError('That item no longer exists.');
  await appendAudit({
    actorUserId,
    action: `${kind}.publish`,
    area: 'Content',
    targetType: kind,
    targetId: id,
    summary: `“${row.title}” published — the published pages inside it can now resolve.`,
  });
  return row;
}

/** Soft delete. Everything has a restore path; nothing here issues a DELETE. */
export async function archive(kind: ContentKind, id: string, actorUserId: string) {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const [row] = await db
    .update(table)
    .set({ archivedAt: new Date(), state: 'archived', updatedAt: new Date() })
    .where(and(eq(table.id, id), isNull(table.archivedAt)))
    .returning();
  if (!row) throw new ContentError('That item is already in the archive.');
  await appendAudit({
    actorUserId,
    action: `${kind}.archive`,
    area: 'Content',
    targetType: kind,
    targetId: id,
    summary: `“${row.title}” moved to the archive — anything it gated is now decided by whatever sits above it.`,
  });
  return row;
}

export async function restore(kind: ContentKind, id: string, actorUserId: string) {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const [row] = await db
    .update(table)
    .set({ archivedAt: null, state: 'draft', updatedAt: new Date() })
    .where(eq(table.id, id))
    .returning();
  if (!row) throw new ContentError('That item no longer exists.');
  await appendAudit({
    actorUserId,
    action: `${kind}.restore`,
    area: 'Content',
    targetType: kind,
    targetId: id,
    summary: `“${row.title}” restored as a draft — publish it when it is ready.`,
  });
  return row;
}

/** The separate, explicit, audited action. The only DELETE in this module. */
export async function purge(kind: ContentKind, id: string, actorUserId: string) {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new ContentError('That item no longer exists.');
  if (!row.archivedAt) throw new ContentError('Only archived items can be purged. Archive it first.');
  await db.delete(table).where(eq(table.id, id));
  await appendAudit({
    actorUserId,
    action: `${kind}.purge`,
    area: 'Content',
    targetType: kind,
    targetId: id,
    summary: `“${row.title}” purged. This one is not recoverable.`,
    before: { title: row.title, slug: row.slug },
  });
}

export async function reorder(kind: ContentKind, id: string, before: string | null, after: string | null) {
  const table = kind === 'section' ? sections : kind === 'topic' ? topics : pages;
  const sortKey = keyBetween(before, after);
  await db.update(table).set({ sortKey, updatedAt: new Date() }).where(eq(table.id, id));
  return sortKey;
}

/**
 * Keep the flattened block text the search index reads in step with the blocks.
 * This is not derived *state* — it is an index, rebuilt from the source of
 * truth on every write, and never read as an answer to a question.
 */
export async function refreshSearchText(pageId: string): Promise<void> {
  const rows = await db
    .select({ kind: blocks.kind, data: blocks.data, publishedAt: blocks.publishedAt })
    .from(blocks)
    .where(and(eq(blocks.pageId, pageId), isNull(blocks.archivedAt)));

  const text = rows
    .filter((b) => b.kind !== 'summary' || b.publishedAt !== null)
    .map((b) => blockText(b.kind, b.data))
    .join(' ')
    .slice(0, 200_000);

  await db.execute(sql`UPDATE page SET search_text = ${text} WHERE id = ${pageId}`);
}
