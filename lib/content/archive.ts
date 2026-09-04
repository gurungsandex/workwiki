import type { Sql } from 'postgres';
import { audit } from '@/lib/audit/write';

/**
 * Soft delete, universal. `archived_at` and a restore path everywhere. Purge is
 * a separate, explicit, audited action.
 *
 * Removal messages state what widened or moved, not what was deleted — the
 * strings live in lib/copy/admin.ts and are part of the design.
 */

export async function archiveNode(sql: Sql, nodeId: string, actorUserId: string) {
  return sql.begin(async (tx) => {
    const [node] = await tx<{ title: string; level: string }[]>`
      SELECT title, level FROM content_node
       WHERE id = ${nodeId}::uuid AND archived_at IS NULL FOR UPDATE`;
    if (!node) return { ok: false as const, error: 'That item is already in the archive.' };

    // Archiving a parent archives its subtree; restore brings the subtree back.
    await tx`
      WITH RECURSIVE subtree AS (
        SELECT id FROM content_node WHERE id = ${nodeId}::uuid
        UNION ALL
        SELECT c.id FROM content_node c JOIN subtree s ON c.parent_id = s.id
      )
      UPDATE content_node SET archived_at = now(), state = 'archived', updated_at = now()
       WHERE id IN (SELECT id FROM subtree) AND archived_at IS NULL`;

    await tx`
      DELETE FROM node_search WHERE node_id IN (
        WITH RECURSIVE subtree AS (
          SELECT id FROM content_node WHERE id = ${nodeId}::uuid
          UNION ALL
          SELECT c.id FROM content_node c JOIN subtree s ON c.parent_id = s.id
        ) SELECT id FROM subtree)`;

    await audit(tx, {
      actorUserId,
      action: 'content.archive',
      area: 'Content',
      targetType: 'content_node',
      targetId: nodeId,
      before: { title: node.title, level: node.level },
    });
    return { ok: true as const, title: node.title };
  });
}

export async function restoreNode(sql: Sql, nodeId: string, actorUserId: string) {
  return sql.begin(async (tx) => {
    const [node] = await tx<{ title: string }[]>`
      SELECT title FROM content_node
       WHERE id = ${nodeId}::uuid AND archived_at IS NOT NULL FOR UPDATE`;
    if (!node) return { ok: false as const, error: 'That item is not in the archive.' };

    // Restored as a DRAFT, never straight back to published.
    await tx`
      WITH RECURSIVE subtree AS (
        SELECT id FROM content_node WHERE id = ${nodeId}::uuid
        UNION ALL
        SELECT c.id FROM content_node c JOIN subtree s ON c.parent_id = s.id
      )
      UPDATE content_node SET archived_at = NULL, state = 'draft', updated_at = now()
       WHERE id IN (SELECT id FROM subtree)`;

    await audit(tx, {
      actorUserId,
      action: 'content.restore',
      area: 'Content',
      targetType: 'content_node',
      targetId: nodeId,
      after: { title: node.title },
    });
    return { ok: true as const, title: node.title };
  });
}

/** Purge is separate, explicit and audited. It is the only hard delete. */
export async function purgeNode(sql: Sql, nodeId: string, actorUserId: string) {
  return sql.begin(async (tx) => {
    const [node] = await tx<{ title: string }[]>`
      SELECT title FROM content_node
       WHERE id = ${nodeId}::uuid AND archived_at IS NOT NULL FOR UPDATE`;
    if (!node) {
      return {
        ok: false as const,
        error: 'Only an archived item can be deleted for good. Archive it first.',
      };
    }
    // Audit BEFORE the delete: the log outlives the row.
    await audit(tx, {
      actorUserId,
      action: 'content.purge',
      area: 'Content',
      targetType: 'content_node',
      targetId: nodeId,
      before: { title: node.title },
    });
    await tx`DELETE FROM content_node WHERE id = ${nodeId}::uuid`;
    return { ok: true as const, title: node.title };
  });
}
