import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { acknowledgments, pages, pageVersions } from '@/db/schema';
import { evaluate } from '@/lib/access/engine';
import { chainFor, loadRuleIndex } from '@/lib/content/read';
import type { Subject } from '@/lib/access/types';
import { appendAudit } from '@/lib/audit';
import { toDate } from '@/lib/rows';

/**
 * Acknowledgment attests a specific published version, identified by its
 * content hash. The client sends back the hash it actually rendered; a mismatch
 * is rejected rather than recorded, because an attestation against content the
 * person did not see is worse than no attestation at all.
 */

export class AcknowledgmentError extends Error {}

export interface OutstandingItem {
  pageId: string;
  slug: string;
  title: string;
  versionId: string;
  versionNo: number;
  contentHash: string;
  publishedAt: Date;
}

/**
 * What is waiting on this person: pages that ask for acknowledgment, that they
 * can actually read, whose current version they have not signed. Computed at
 * read time — there is no `progress` column and never will be.
 */
export async function outstandingFor(subject: Subject, at: Date = new Date()): Promise<OutstandingItem[]> {
  const rows = await db.execute<{
    page_id: string;
    slug: string;
    title: string;
    section_id: string;
    topic_id: string;
    version_id: string;
    version_no: number;
    content_hash: string;
    published_at: string | Date;
  }>(sql`
    SELECT DISTINCT ON (p.id)
      p.id AS page_id, p.slug, p.title, s.id AS section_id, t.id AS topic_id,
      v.id AS version_id, v.version_no, v.content_hash, v.published_at
    FROM page p
    JOIN topic t ON t.id = p.topic_id
    JOIN section s ON s.id = t.section_id
    JOIN page_version v ON v.page_id = p.id
    WHERE p.requires_acknowledgment
      AND p.state = 'published' AND p.archived_at IS NULL
      AND t.state = 'published' AND t.archived_at IS NULL
      AND s.state = 'published' AND s.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM acknowledgment a
        WHERE a.page_version_id = v.id AND a.user_id = ${subject.userId}
      )
    ORDER BY p.id, v.version_no DESC
  `);

  if (rows.rows.length === 0) return [];

  const index = await loadRuleIndex();
  return rows.rows
    .filter((row) => {
      const decision = evaluate(
        subject,
        chainFor(index, { sectionId: row.section_id, topicId: row.topic_id, pageId: row.page_id }),
        at,
      );
      // Only what they can actually read is waiting on them. A locked policy is
      // not outstanding; it has not reached them yet.
      return decision.allowed;
    })
    .map((row) => ({
      pageId: row.page_id,
      slug: row.slug,
      title: row.title,
      versionId: row.version_id,
      versionNo: row.version_no,
      contentHash: row.content_hash,
      publishedAt: toDate(row.published_at),
    }));
}

/**
 * Record an acknowledgment. The version and the hash the client rendered are
 * both checked; a re-acknowledgment of a new version is a new row, never an
 * update of the old one (the database refuses the update outright).
 */
export async function acknowledge(input: {
  subject: Subject;
  pageVersionId: string;
  contentHash: string;
  ipHash?: string | null;
  at?: Date;
}): Promise<{ alreadySigned: boolean }> {
  const [version] = await db
    .select({
      id: pageVersions.id,
      pageId: pageVersions.pageId,
      contentHash: pageVersions.contentHash,
      versionNo: pageVersions.versionNo,
    })
    .from(pageVersions)
    .where(eq(pageVersions.id, input.pageVersionId))
    .limit(1);

  if (!version) throw new AcknowledgmentError('That version no longer exists. Reload the page and read it again.');

  if (version.contentHash !== input.contentHash) {
    throw new AcknowledgmentError(
      'This page changed while you had it open. Reload it and read the current version before acknowledging.',
    );
  }

  const [page] = await db
    .select({ id: pages.id, slug: pages.slug, title: pages.title, topicId: pages.topicId })
    .from(pages)
    .where(and(eq(pages.id, version.pageId), isNull(pages.archivedAt)))
    .limit(1);
  if (!page) throw new AcknowledgmentError('That page is no longer published.');

  // Acknowledging is a read of the page: it goes through the same evaluator.
  const readable = await canRead(input.subject, page.id, input.at ?? new Date());
  if (!readable) throw new AcknowledgmentError('That page is not available to you.');

  const inserted = await db
    .insert(acknowledgments)
    .values({
      userId: input.subject.userId,
      pageVersionId: version.id,
      contentHash: input.contentHash,
      ipHash: input.ipHash ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: acknowledgments.id });

  if (inserted.length === 0) return { alreadySigned: true };

  await appendAudit({
    actorUserId: input.subject.userId,
    action: 'acknowledgment.sign',
    area: 'Content',
    targetType: 'page_version',
    targetId: version.id,
    summary: `“${page.title}” acknowledged at version ${version.versionNo}.`,
  });

  return { alreadySigned: false };
}

async function canRead(subject: Subject, pageId: string, at: Date): Promise<boolean> {
  const rows = await db.execute<{ section_id: string; topic_id: string }>(sql`
    SELECT s.id AS section_id, t.id AS topic_id
    FROM page p JOIN topic t ON t.id = p.topic_id JOIN section s ON s.id = t.section_id
    WHERE p.id = ${pageId} AND p.state = 'published' AND p.archived_at IS NULL
      AND t.state = 'published' AND t.archived_at IS NULL
      AND s.state = 'published' AND s.archived_at IS NULL
  `);
  const row = rows.rows[0];
  if (!row) return false;
  const index = await loadRuleIndex();
  return evaluate(subject, chainFor(index, { sectionId: row.section_id, topicId: row.topic_id, pageId }), at).allowed;
}

export interface SignedItem {
  pageTitle: string;
  slug: string;
  versionNo: number;
  acknowledgedAt: Date;
  supersededByVersionNo: number | null;
}

/** The employee's own attestation history, with the version each one attested. */
export async function historyFor(userId: string): Promise<SignedItem[]> {
  const rows = await db.execute<{
    title: string;
    slug: string;
    version_no: number;
    acknowledged_at: string | Date;
    latest_version_no: number;
  }>(sql`
    SELECT p.title, p.slug, v.version_no, a.acknowledged_at,
           (SELECT max(version_no) FROM page_version WHERE page_id = p.id) AS latest_version_no
    FROM acknowledgment a
    JOIN page_version v ON v.id = a.page_version_id
    JOIN page p ON p.id = v.page_id
    WHERE a.user_id = ${userId}
    ORDER BY a.acknowledged_at DESC
  `);
  return rows.rows.map((r) => ({
    pageTitle: r.title,
    slug: r.slug,
    versionNo: r.version_no,
    acknowledgedAt: toDate(r.acknowledged_at),
    supersededByVersionNo: r.latest_version_no > r.version_no ? r.latest_version_no : null,
  }));
}

/**
 * Coverage for the admin, counted against the people each policy actually
 * reaches — never against the whole roster. Computed here, stored nowhere.
 */
export async function coverageFor(pageId: string, subjects: Subject[], at: Date = new Date()) {
  const [version] = await db
    .select({ id: pageVersions.id, versionNo: pageVersions.versionNo })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.versionNo))
    .limit(1);
  if (!version) return { reached: 0, signed: 0, outstanding: [] as string[] };

  const rows = await db.execute<{ section_id: string; topic_id: string }>(sql`
    SELECT s.id AS section_id, t.id AS topic_id
    FROM page p JOIN topic t ON t.id = p.topic_id JOIN section s ON s.id = t.section_id
    WHERE p.id = ${pageId}
  `);
  const location = rows.rows[0];
  if (!location) return { reached: 0, signed: 0, outstanding: [] };

  const index = await loadRuleIndex();
  const reached = subjects.filter(
    (subject) =>
      evaluate(subject, chainFor(index, { sectionId: location.section_id, topicId: location.topic_id, pageId }), at)
        .allowed,
  );
  if (reached.length === 0) return { reached: 0, signed: 0, outstanding: [] };

  const signedRows = await db
    .select({ userId: acknowledgments.userId })
    .from(acknowledgments)
    .where(
      and(
        eq(acknowledgments.pageVersionId, version.id),
        inArray(
          acknowledgments.userId,
          reached.map((s) => s.userId),
        ),
      ),
    );
  const signed = new Set(signedRows.map((r) => r.userId));

  return {
    reached: reached.length,
    signed: signed.size,
    outstanding: reached.filter((s) => !signed.has(s.userId)).map((s) => s.userId),
  };
}
