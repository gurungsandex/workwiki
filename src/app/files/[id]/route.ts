import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { files } from '@/db/schema';
import { evaluate } from '@/lib/access/engine';
import { requireReader } from '@/lib/auth/guards';
import { chainFor, loadRuleIndex } from '@/lib/content/read';
import { signedReadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Files are never public. Every fetch proxies through here: the reader is
 * resolved, the evaluator decides, and only then is a short-lived signed URL
 * issued. The bucket has no public policy and the key is random, so a leaked
 * URL expires rather than persisting.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { subject } = await requireReader();

  const [file] = await db
    .select({ id: files.id, storageKey: files.storageKey, originalName: files.originalName, scanState: files.scanState })
    .from(files)
    .where(and(eq(files.id, id), isNull(files.archivedAt)))
    .limit(1);

  if (!file) return new NextResponse('Not found', { status: 404 });
  if (file.scanState === 'infected') return new NextResponse('Not found', { status: 404 });

  /*
   * Which published pages embed this file? The reader needs access to at least
   * one of them. A file nothing references is not reachable at all.
   */
  const referencing = await db.execute<{ section_id: string; topic_id: string; page_id: string }>(sql`
    SELECT DISTINCT s.id AS section_id, t.id AS topic_id, p.id AS page_id
    FROM block b
    JOIN page p ON p.id = b.page_id
    JOIN topic t ON t.id = p.topic_id
    JOIN section s ON s.id = t.section_id
    WHERE b.archived_at IS NULL
      AND (b.source_file_id = ${id} OR b.data ->> 'fileId' = ${id})
      AND p.state = 'published' AND p.archived_at IS NULL
      AND t.state = 'published' AND t.archived_at IS NULL
      AND s.state = 'published' AND s.archived_at IS NULL
  `);

  if (referencing.rows.length === 0) return new NextResponse('Not found', { status: 404 });

  const index = await loadRuleIndex();
  const permitted = referencing.rows.some(
    (row) =>
      evaluate(subject, chainFor(index, { sectionId: row.section_id, topicId: row.topic_id, pageId: row.page_id }))
        .allowed,
  );

  // A locked page's attachment is not a way around the lock.
  if (!permitted) return new NextResponse('Not found', { status: 404 });

  const url = await signedReadUrl(file.storageKey, file.originalName);
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'cache-control': 'private, no-store' },
  });
}
