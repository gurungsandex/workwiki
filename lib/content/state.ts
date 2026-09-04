import type { Sql } from 'postgres';
import { contentHash } from './canonical';
import { blockText, guideHandoffProblem } from './blocks';
import { audit } from '@/lib/audit/write';

export type NodeState = 'draft' | 'published' | 'archived';
export type Transition = 'publish' | 'unpublish' | 'archive' | 'restore';

/**
 * The content state machine. Draft until published; publishing writes an
 * immutable version and stamps a byline; archive is soft and reversible.
 */

const LEGAL: Record<NodeState, Partial<Record<Transition, NodeState>>> = {
  draft: { publish: 'published', archive: 'archived' },
  published: { unpublish: 'draft', archive: 'archived' },
  archived: { restore: 'draft' },
};

export function nextState(from: NodeState, t: Transition): NodeState | null {
  return LEGAL[from][t] ?? null;
}

export function transitionProblem(from: NodeState, t: Transition): string | null {
  if (nextState(from, t)) return null;
  const legal = Object.keys(LEGAL[from]);
  return legal.length === 0
    ? `A ${from} item cannot be changed.`
    : `A ${from} item cannot be ${t}ed. It can be: ${legal.join(', ')}.`;
}

export type PublishResult =
  | { ok: true; versionNo: number; contentHashHex: string }
  | { ok: false; error: string };

/**
 * Publishes a node: snapshots its blocks, writes an immutable page_version,
 * refreshes the search projection and appends an audit event — all in ONE
 * transaction, so a half-published page cannot exist.
 */
export async function publishNode(
  sql: Sql,
  nodeId: string,
  actorUserId: string,
  opts: { effectiveDate?: string | null; note?: string | null } = {},
): Promise<PublishResult> {
  return sql.begin(async (tx) => {
    const [node] = await tx<
      { id: string; title: string; state: NodeState; level: string; archived_at: Date | null }[]
    >`SELECT id, title, state, level, archived_at FROM content_node
       WHERE id = ${nodeId}::uuid FOR UPDATE`;

    if (!node) return { ok: false as const, error: 'That item does not exist.' };
    if (node.archived_at) {
      return { ok: false as const, error: 'That item is in the archive. Restore it first.' };
    }
    const problem = transitionProblem(node.state, 'publish');
    if (problem) return { ok: false as const, error: problem };

    const blocks = await tx<
      {
        id: string;
        kind: string;
        slot: string | null;
        sort_key: string;
        data: unknown;
        published_at: Date | null;
        byline_kind: string | null;
      }[]
    >`SELECT id, kind, slot, sort_key, data, published_at, byline_kind
        FROM block WHERE node_id = ${nodeId}::uuid AND archived_at IS NULL
       ORDER BY sort_key ASC, id ASC`;

    // A guide that stops in mid-air never reaches an employee.
    for (const b of blocks) {
      if (b.kind === 'guide') {
        const gp = guideHandoffProblem(b.data);
        if (gp) return { ok: false as const, error: gp };
      }
      // A drafted summary is not published by publishing the page around it.
      if (b.kind === 'summary' && b.published_at === null) {
        return {
          ok: false as const,
          error:
            'The summary on this page is still a draft. Publish the summary itself, or remove it — a generated summary is never published for you.',
        };
      }
    }

    const snapshot = {
      nodeId: node.id,
      title: node.title,
      blocks: blocks.map((b) => ({
        id: b.id,
        kind: b.kind,
        slot: b.slot,
        sortKey: b.sort_key,
        data: b.data,
      })),
    };
    const hash = contentHash(snapshot);

    const versionRows = await tx<{ next_no: number }[]>`
      SELECT COALESCE(max(version_no), 0) + 1 AS next_no
        FROM page_version WHERE node_id = ${nodeId}::uuid`;
    const nextNo = versionRows[0]!.next_no;

    await tx`
      INSERT INTO page_version
        (node_id, version_no, snapshot, content_hash, effective_date, note, published_by)
      VALUES (${nodeId}::uuid, ${nextNo}, ${tx.json(snapshot as never)}, ${hash},
              ${opts.effectiveDate ?? null}, ${opts.note ?? null}, ${actorUserId}::uuid)`;

    await tx`UPDATE content_node SET state = 'published', updated_at = now()
              WHERE id = ${nodeId}::uuid`;

    const body = blocks.map((b) => blockText(b.kind, b.data)).join(' ').slice(0, 200_000);
    await tx`
      INSERT INTO node_search (node_id, title, body, updated_at)
      VALUES (${nodeId}::uuid, ${node.title}, ${body}, now())
      ON CONFLICT (node_id) DO UPDATE
        SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = now()`;

    await audit(tx, {
      actorUserId,
      action: 'content.publish',
      area: 'Content',
      targetType: 'content_node',
      targetId: nodeId,
      after: { title: node.title, versionNo: nextNo },
    });

    return {
      ok: true as const,
      versionNo: nextNo,
      contentHashHex: hash.toString('hex'),
    };
  });
}

/** Unpublishing never destroys a version; the history stays readable. */
export async function unpublishNode(sql: Sql, nodeId: string, actorUserId: string) {
  return sql.begin(async (tx) => {
    const [node] = await tx<{ state: NodeState; title: string }[]>`
      SELECT state, title FROM content_node WHERE id = ${nodeId}::uuid FOR UPDATE`;
    if (!node) return { ok: false as const, error: 'That item does not exist.' };
    const problem = transitionProblem(node.state, 'unpublish');
    if (problem) return { ok: false as const, error: problem };

    await tx`UPDATE content_node SET state = 'draft', updated_at = now()
              WHERE id = ${nodeId}::uuid`;
    await tx`DELETE FROM node_search WHERE node_id = ${nodeId}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'content.unpublish',
      area: 'Content',
      targetType: 'content_node',
      targetId: nodeId,
      after: { title: node.title },
    });
    return { ok: true as const };
  });
}
