import { sql } from '@/lib/db/client';
import { ContentEditor, type NodeRow } from './ContentEditor';
import type { BlockRow } from './BlockEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sections' };

/**
 * The authoring surface.
 *
 * Every state on this page is read live: whether a node is published, how many
 * versions exist, and whether any rule in its ancestry reaches anybody. That
 * last one is the check most worth surfacing — nothing is public by default, so
 * a page can be perfectly written, published, and still read by no one.
 */
export default async function Content() {
  const db = sql();

  const nodes = await db<NodeRow[]>`
    SELECT n.id, n.level, n.parent_id AS "parentId", n.depth, n.title, n.slug,
           n.state, n.teaser, (n.archived_at IS NOT NULL) AS archived,
           (SELECT count(*) FROM page_version v WHERE v.node_id = n.id)::int AS versions,
           EXISTS (
             WITH RECURSIVE up AS (
               SELECT id, parent_id FROM content_node WHERE id = n.id
               UNION ALL
               SELECT p.id, p.parent_id FROM content_node p JOIN up ON p.id = up.parent_id
             )
             SELECT 1 FROM access_rule r
              WHERE r.target_type = 'node' AND r.archived_at IS NULL
                AND r.effect = 'allow'
                AND r.target_id IN (SELECT id FROM up)
           ) AS "hasRule"
      FROM content_node n
     ORDER BY n.depth, n.sort_key, n.title`;

  const blockRows = await db<(BlockRow & { nodeId: string })[]>`
    SELECT b.id, b.node_id AS "nodeId", b.kind, b.slot, b.data,
           b.published_at AS "publishedAt", b.byline_kind AS "bylineKind",
           b.source_url AS "sourceUrl"
      FROM block b
     WHERE b.archived_at IS NULL
     ORDER BY b.sort_key`;

  const blocks: Record<string, BlockRow[]> = {};
  for (const b of blockRows) {
    (blocks[b.nodeId] ??= []).push(b);
  }

  const kinds = await db<{ id: string; name: string; neverSummarised: boolean }[]>`
    SELECT id, name, never_summarised AS "neverSummarised"
      FROM content_kind WHERE archived_at IS NULL ORDER BY sort_key, name`;

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Sections</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>What employees read</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        A section holds topics, a topic holds pages, and a page is the thing an
        employee reads. Three levels, capped by the database rather than by a warning.
      </p>
      <p className="note" style={{ marginBottom: 32, fontStyle: 'italic' }}>
        Nothing here reaches anybody until two things are true: you publish it, and a
        rule allows it. Publishing snapshots exactly what is on the page at that moment
        — later edits stay in draft until you publish again, so an employee never sees a
        page change under them.
      </p>

      <ContentEditor nodes={nodes} blocks={blocks} kinds={kinds} />
    </>
  );
}
