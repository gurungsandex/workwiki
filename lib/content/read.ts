import type { Sql } from 'postgres';
import { evaluate } from '@/lib/access/evaluate';
import { resolveChain } from '@/lib/access/resolve-chain';
import { nodeAccessCte } from '@/lib/access/compile';
import type { Decision, Subject } from '@/lib/access/types';

/**
 * Every employee content read goes through here. There is no unfiltered read
 * path: a caller cannot ask for a body and filter it afterwards, because the
 * body is not attached to the returned object unless the decision allows it.
 */

export type TreeItem = {
  id: string;
  level: 'section' | 'topic' | 'page';
  parentId: string | null;
  title: string;
  slug: string;
  /** Present only when the item is locked, never when hidden. */
  teaser: string | null;
  unlockAt: string | null;
  locked: boolean;
};

/**
 * The access-filtered navigation tree.
 *
 * A hidden node is ABSENT from the result, not present-and-flagged, so a client
 * bug cannot render it. A section with no visible descendant is dropped
 * entirely: a section with nothing published in it is hidden from navigation.
 */
export async function readTree(
  sql: Sql,
  subject: Subject,
  at: Date = new Date(),
): Promise<TreeItem[]> {
  const cte = nodeAccessCte(sql, subject, at);
  const rows = await sql<
    {
      id: string;
      level: 'section' | 'topic' | 'page';
      parent_id: string | null;
      title: string;
      slug: string;
      teaser: string | null;
      sort_key: string;
      allowed: boolean;
      visibility: string;
      unlock_at: Date | null;
    }[]
  >`
    ${cte}
    SELECT n.id, n.level, n.parent_id, n.title, n.slug, n.teaser, n.sort_key,
           a.allowed, a.visibility, a.unlock_at
      FROM content_node n
      JOIN node_access a ON a.node_id = n.id
     WHERE n.archived_at IS NULL
       AND n.state = 'published'
       AND (n.publish_at IS NULL OR n.publish_at <= ${at})
       AND (n.unpublish_at IS NULL OR n.unpublish_at > ${at})
       AND a.visibility <> 'hidden'
     ORDER BY n.level, n.sort_key, n.title`;

  // A page whose section or topic is not published is not reachable either.
  // Publishing is per node, so an admin can unpublish a section and leave its
  // pages published; without this they would arrive as orphans with no place in
  // Browse. Everything must be published all the way up to be visible.
  const publishedIds = new Set(rows.map((r) => r.id));
  const reachable = rows.filter((r) => {
    let parent = r.parent_id;
    const byId = new Map(rows.map((x) => [x.id, x]));
    while (parent !== null) {
      if (!publishedIds.has(parent)) return false;
      parent = byId.get(parent)?.parent_id ?? null;
    }
    return true;
  });

  const items: TreeItem[] = reachable.map((r) => ({
    id: r.id,
    level: r.level,
    parentId: r.parent_id,
    title: r.title,
    slug: r.slug,
    // A locked item shows title + unlock date + one line. Nothing else.
    teaser: r.allowed ? null : r.teaser,
    unlockAt: r.unlock_at ? r.unlock_at.toISOString() : null,
    locked: !r.allowed,
  }));

  return dropEmptyBranches(items);
}

/**
 * A section or topic with no surviving child is absent, never an empty card.
 *
 * Pruned to a fixpoint, not in one pass: dropping every childless topic can
 * leave its section childless in turn, and that section must go too.
 */
function dropEmptyBranches(items: TreeItem[]): TreeItem[] {
  let current = items;
  for (;;) {
    const hasChild = new Set(
      current.map((i) => i.parentId).filter((p): p is string => p !== null),
    );
    const next = current.filter((i) => i.level === 'page' || hasChild.has(i.id));
    if (next.length === current.length) return next;
    current = next;
  }
}

export type PageRead =
  | { kind: 'not-found' }
  | {
      kind: 'locked';
      id: string;
      title: string;
      teaser: string | null;
      unlockAt: string | null;
    }
  | {
      kind: 'full';
      id: string;
      title: string;
      versionId: string;
      versionNo: number;
      contentHashHex: string;
      blocks: { id: string; kind: string; slot: string | null; data: unknown }[];
      decision: Decision;
    };

/**
 * Reads one page for one subject.
 *
 * Unpublished is indistinguishable from absent (not routable). Locked returns a
 * teaser payload with no body. The full body is fetched only AFTER the decision
 * says so — the query for blocks does not run otherwise.
 */
export async function readPage(
  sql: Sql,
  subject: Subject,
  slug: string,
  at: Date = new Date(),
): Promise<PageRead> {
  const [node] = await sql<
    { id: string; title: string; teaser: string | null; state: string }[]
  >`
    SELECT id, title, teaser, state FROM content_node
     WHERE slug = ${slug} AND level = 'page' AND archived_at IS NULL`;

  // Unpublished is not routable: the same answer as a slug that never existed,
  // so an employee cannot probe for draft titles. The whole ancestry must be
  // published too — an unpublished section takes its pages with it.
  if (!node || node.state !== 'published') return { kind: 'not-found' };

  const unpublishedAncestor = await sql<{ n: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, state, archived_at FROM content_node WHERE id = ${node.id}::uuid
      UNION ALL
      SELECT p.id, p.parent_id, p.state, p.archived_at
        FROM content_node p JOIN up ON p.id = up.parent_id
    )
    SELECT count(*)::text AS n FROM up
     WHERE state <> 'published' OR archived_at IS NOT NULL`;
  if (Number(unpublishedAncestor[0]?.n ?? 0) > 0) return { kind: 'not-found' };

  const chain = await resolveChain(sql, node.id);
  const decision = evaluate(subject, chain, at);

  if (decision.visibility === 'hidden') return { kind: 'not-found' };

  if (!decision.allowed) {
    return {
      kind: 'locked',
      id: node.id,
      title: node.title,
      teaser: node.teaser,
      unlockAt: decision.unlockAt ? decision.unlockAt.toISOString() : null,
    };
  }

  const [version] = await sql<
    { id: string; version_no: number; snapshot: unknown; content_hash: Buffer }[]
  >`
    SELECT id, version_no, snapshot, content_hash FROM page_version
     WHERE node_id = ${node.id}::uuid ORDER BY version_no DESC LIMIT 1`;

  if (!version) return { kind: 'not-found' };

  const snapshot = version.snapshot as {
    blocks: { id: string; kind: string; slot: string | null; data: unknown }[];
  };

  return {
    kind: 'full',
    id: node.id,
    title: node.title,
    versionId: version.id,
    versionNo: version.version_no,
    contentHashHex: version.content_hash.toString('hex'),
    blocks: snapshot.blocks ?? [],
    decision,
  };
}
