import type { Sql } from 'postgres';
import { z } from 'zod';
import { audit } from '@/lib/audit/write';
import { validateBlockData, SLOTS } from './blocks';

/**
 * Authoring: the content tree and the blocks inside it.
 *
 * Ordering uses a fractional index so a move is a single-row UPDATE. The key is
 * a short string compared lexicographically; a move computes a key strictly
 * between its new neighbours.
 */

export const LEVELS = ['section', 'topic', 'page'] as const;
export type Level = (typeof LEVELS)[number];

type Failure = { ok: false; error: string };

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A key strictly between `before` and `after`, either of which may be null for
 * an open end. Compared lexicographically, so reordering never rewrites the
 * other rows.
 *
 * Two rules make this total:
 *  - a position past the end of `before` reads as the FLOOR digit, and past the
 *    end of `after` as the CEILING, so an exhausted bound still leaves room;
 *  - the bare floor digit is never returned as a whole key, because nothing can
 *    sort before it. midKey(null, x) needs somewhere below x to go, and "0…"
 *    only works while no key is exactly "0".
 */
export function midKey(before: string | null, after: string | null): string {
  const a = before ?? '';
  const base = ALPHABET.length;
  let prefix = '';

  for (let i = 0; ; i++) {
    const lo = i < a.length ? ALPHABET.indexOf(a[i]!) : 0;
    const hi = after !== null && i < after.length ? ALPHABET.indexOf(after[i]!) : base;

    if (hi - lo > 1) {
      // Room at this position: take the midpoint, nudged up so the result is
      // strictly greater than `before` rather than equal to it.
      const mid = Math.max(lo + 1, Math.floor((lo + hi) / 2));
      return prefix + ALPHABET[mid];
    }

    // No room here. Carry `before`'s digit (or the floor) and look one deeper.
    prefix += ALPHABET[lo];
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

async function uniqueNodeSlug(sql: Sql, title: string): Promise<string> {
  const base = slugify(title) || 'page';
  for (let n = 0; n < 60; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const rows = await sql`
      SELECT 1 FROM content_node WHERE slug = ${candidate} AND archived_at IS NULL LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Slugs are global because /p/[slug] routes on them alone. */
async function nextSortKey(sql: Sql, parentId: string | null): Promise<string> {
  const rows = await sql<{ sort_key: string }[]>`
    SELECT sort_key FROM content_node
     WHERE parent_id IS NOT DISTINCT FROM ${parentId}::uuid AND archived_at IS NULL
     ORDER BY sort_key DESC LIMIT 1`;
  return midKey(rows[0]?.sort_key ?? null, null);
}

export const createNodeInput = z.object({
  level: z.enum(LEVELS),
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  teaser: z.string().max(300).nullable().optional(),
  contentKindId: z.string().uuid().nullable().optional(),
});

export async function createNode(
  sql: Sql,
  input: z.infer<typeof createNodeInput>,
  actorUserId: string,
): Promise<{ ok: true; id: string; message: string } | Failure> {
  const title = input.title.trim();
  const parentId = input.parentId ?? null;

  if (input.level !== 'section' && !parentId) {
    return { ok: false, error: `A ${input.level} needs a parent. Only a section stands alone.` };
  }
  if (input.level === 'section' && parentId) {
    return { ok: false, error: 'A section is the top level; it cannot sit inside anything.' };
  }

  const slug = await uniqueNodeSlug(sql, title);
  const sortKey = await nextSortKey(sql, parentId);

  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO content_node (level, parent_id, title, slug, sort_key, teaser, content_kind_id, created_by)
        VALUES (${input.level}, ${parentId}::uuid, ${title}, ${slug}, ${sortKey},
                ${input.teaser ?? null}, ${input.contentKindId ?? null}::uuid,
                ${actorUserId}::uuid)
        RETURNING id`;
      await audit(tx, {
        actorUserId,
        action: `content.create.${input.level}`,
        area: 'Content',
        targetType: 'content_node',
        targetId: rows[0]!.id,
        after: { title, level: input.level },
      });
      return {
        ok: true as const,
        id: rows[0]!.id,
        message: `${title} added as a draft — nobody can see it yet.`,
      };
    });
  } catch (e) {
    // The depth/ladder trigger raises a readable message; surface it as-is.
    const message = e instanceof Error ? e.message : 'That could not be created.';
    return { ok: false, error: message.replace(/^.*?ERROR:\s*/i, '') };
  }
}

export const updateNodeInput = z.object({
  title: z.string().min(1).max(200).optional(),
  teaser: z.string().max(300).nullable().optional(),
  contentKindId: z.string().uuid().nullable().optional(),
  reviewDueAt: z.string().nullable().optional(),
});

export async function updateNode(
  sql: Sql,
  id: string,
  input: z.infer<typeof updateNodeInput>,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ title: string; state: string }[]>`
      SELECT title, state FROM content_node
       WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE`;
    const node = rows[0];
    if (!node) return { ok: false as const, error: 'That item does not exist.' };

    await tx`
      UPDATE content_node SET
        title = COALESCE(${input.title ?? null}, title),
        teaser = ${input.teaser === undefined ? tx`teaser` : input.teaser},
        content_kind_id = ${input.contentKindId === undefined ? tx`content_kind_id` : tx`${input.contentKindId}::uuid`},
        review_due_at = ${input.reviewDueAt === undefined ? tx`review_due_at` : tx`${input.reviewDueAt}::date`},
        updated_at = now()
      WHERE id = ${id}::uuid`;

    await audit(tx, {
      actorUserId,
      action: 'content.update',
      area: 'Content',
      targetType: 'content_node',
      targetId: id,
      before: { title: node.title },
      after: { title: input.title ?? node.title },
    });

    // Editing a published page does NOT republish it: the live version is the
    // last published one until an admin publishes again.
    return {
      ok: true as const,
      message:
        node.state === 'published'
          ? `Saved. Employees still see the last published version until you publish again.`
          : 'Saved.',
    };
  });
}

/** Moves a node among its siblings. One row changes. */
export async function reorderNode(
  sql: Sql,
  id: string,
  direction: 'up' | 'down',
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ parent_id: string | null; sort_key: string; title: string }[]>`
      SELECT parent_id, sort_key, title FROM content_node
       WHERE id = ${id}::uuid AND archived_at IS NULL`;
    const node = rows[0];
    if (!node) return { ok: false as const, error: 'That item does not exist.' };

    const siblings = await tx<{ id: string; sort_key: string }[]>`
      SELECT id, sort_key FROM content_node
       WHERE parent_id IS NOT DISTINCT FROM ${node.parent_id}::uuid
         AND archived_at IS NULL
       ORDER BY sort_key`;

    const index = siblings.findIndex((s) => s.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) {
      return { ok: false as const, error: `${node.title} is already ${direction === 'up' ? 'first' : 'last'}.` };
    }

    const before = direction === 'up' ? (siblings[target - 1]?.sort_key ?? null) : siblings[target]!.sort_key;
    const after = direction === 'up' ? siblings[target]!.sort_key : (siblings[target + 1]?.sort_key ?? null);

    await tx`UPDATE content_node SET sort_key = ${midKey(before, after)}, updated_at = now()
              WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'content.reorder',
      area: 'Content',
      targetType: 'content_node',
      targetId: id,
      after: { title: node.title, direction },
    });
    return { ok: true as const, message: 'Order changed.' };
  });
}

/* ------------------------------------------------------------------ blocks */

export const blockInput = z.object({
  nodeId: z.string().uuid(),
  kind: z.string().min(1).max(60),
  slot: z.enum(SLOTS).nullable().optional(),
  data: z.unknown(),
  sourceUrl: z.string().url().nullable().optional(),
  sourceFileId: z.string().uuid().nullable().optional(),
});

export async function createBlock(
  sql: Sql,
  input: z.infer<typeof blockInput>,
  actorUserId: string,
): Promise<{ ok: true; id: string; message: string } | Failure> {
  const validated = validateBlockData(input.kind, input.data);
  if (!validated.ok) return { ok: false, error: validated.error };

  // A summary must name what it summarises — the database enforces this too,
  // but a readable message beats a constraint violation.
  if (input.kind === 'summary' && !input.sourceUrl && !input.sourceFileId) {
    return {
      ok: false,
      error:
        'A summary has to say what it summarises. Give it the source document or a link before saving it.',
    };
  }

  const existing = await sql<{ sort_key: string }[]>`
    SELECT sort_key FROM block
     WHERE node_id = ${input.nodeId}::uuid AND archived_at IS NULL
     ORDER BY sort_key DESC LIMIT 1`;

  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO block (node_id, kind, slot, sort_key, data, source_url, source_file_id, created_by)
      VALUES (${input.nodeId}::uuid, ${input.kind}, ${input.slot ?? null},
              ${midKey(existing[0]?.sort_key ?? null, null)},
              ${tx.json(validated.data as never)},
              ${input.sourceUrl ?? null}, ${input.sourceFileId ?? null}::uuid,
              ${actorUserId}::uuid)
      RETURNING id`;
    await audit(tx, {
      actorUserId,
      action: `content.block.create.${input.kind}`,
      area: 'Content',
      targetType: 'block',
      targetId: rows[0]!.id,
    });
    return {
      ok: true as const,
      id: rows[0]!.id,
      message:
        input.kind === 'summary'
          ? 'Summary saved as a draft. Nobody sees a word of it until you publish it.'
          : 'Block added.',
    };
  });
}

export async function updateBlock(
  sql: Sql,
  id: string,
  data: unknown,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  const rows = await sql<{ kind: string; published_at: Date | null }[]>`
    SELECT kind, published_at FROM block WHERE id = ${id}::uuid AND archived_at IS NULL`;
  const block = rows[0];
  if (!block) return { ok: false, error: 'That block does not exist.' };

  const validated = validateBlockData(block.kind, data);
  if (!validated.ok) return { ok: false, error: validated.error };

  return sql.begin(async (tx) => {
    // Editing a published summary takes it back to draft: a summary that
    // changed under an employee without being re-read is how wrong information
    // stays live.
    const unpublishes = block.kind === 'summary' && block.published_at !== null;
    await tx`
      UPDATE block SET data = ${tx.json(validated.data as never)},
             published_at = ${unpublishes ? null : tx`published_at`},
             published_by = ${unpublishes ? null : tx`published_by`},
             byline_kind = ${unpublishes ? null : tx`byline_kind`},
             drafted_by_platform = false,
             updated_at = now()
       WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'content.block.update',
      area: 'Content',
      targetType: 'block',
      targetId: id,
    });
    return {
      ok: true as const,
      message: unpublishes
        ? 'Saved, and taken back to draft — a summary that changed under an employee without being re-read is how wrong information stays live.'
        : 'Saved.',
    };
  });
}

export async function archiveBlock(
  sql: Sql,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ kind: string }[]>`
      SELECT kind FROM block WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE`;
    if (!rows[0]) return { ok: false as const, error: 'That block is already removed.' };
    await tx`UPDATE block SET archived_at = now(), updated_at = now() WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'content.block.archive',
      area: 'Content',
      targetType: 'block',
      targetId: id,
    });
    return { ok: true as const, message: 'Block removed from the draft.' };
  });
}

/**
 * Publishing a summary stamps a byline. A required posting takes a different
 * byline: the admin confirms the source, and the platform never summarises it.
 */
export async function publishSummary(
  sql: Sql,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ kind: string; node_id: string; never_summarised: boolean | null }[]>`
      SELECT b.kind, b.node_id, k.never_summarised
        FROM block b
        JOIN content_node n ON n.id = b.node_id
        LEFT JOIN content_kind k ON k.id = n.content_kind_id
       WHERE b.id = ${id}::uuid AND b.archived_at IS NULL FOR UPDATE OF b`;
    const block = rows[0];
    if (!block) return { ok: false as const, error: 'That block does not exist.' };
    if (block.kind !== 'summary') {
      return { ok: false as const, error: 'Only a summary is published on its own.' };
    }

    const byline = block.never_summarised ? 'confirmed_source' : 'authored';
    await tx`
      UPDATE block SET published_at = now(), published_by = ${actorUserId}::uuid,
             byline_kind = ${byline}, updated_at = now()
       WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'content.block.publish_summary',
      area: 'Content',
      targetType: 'block',
      targetId: id,
      after: { bylineKind: byline },
    });
    return {
      ok: true as const,
      message:
        byline === 'confirmed_source'
          ? 'Source confirmed — stamped with your name and today. This platform does not summarise a required posting.'
          : 'Summary published — stamped with your name and today.',
    };
  });
}
