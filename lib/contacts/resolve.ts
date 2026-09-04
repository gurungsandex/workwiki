import type { Sql } from 'postgres';
import type { Subject } from '@/lib/access/types';

/**
 * The contact resolution chain: page -> topic -> section -> department ->
 * default HR fallback.
 *
 * The spec's §9 listing omits `topic`, which is a level in its own hierarchy;
 * that reads as an oversight and the topic level is included here.
 *
 * Any unfilled surface is HIDDEN, never rendered as an empty card — so this
 * returns null rather than a placeholder.
 */

export type ResolvedContact = {
  id: string;
  purpose: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  about: string | null;
  responseTimeNote: string | null;
  resolvedFrom: 'page' | 'topic' | 'section' | 'department' | 'location' | 'default';
};

type Viewer = { isAdmin: boolean; isManager: boolean };

/** Per-field visibility is applied HERE, the single place responses are built. */
function applyFieldVisibility(
  row: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    about: string | null;
    response_time_note: string | null;
    field_visibility: Record<string, string> | null;
  },
  viewer: Viewer,
  purpose: string,
  resolvedFrom: ResolvedContact['resolvedFrom'],
): ResolvedContact {
  const vis = row.field_visibility ?? {};
  const allowed = (field: string) => {
    const level = vis[field] ?? 'all';
    if (level === 'all') return true;
    if (level === 'managers') return viewer.isManager || viewer.isAdmin;
    if (level === 'admins') return viewer.isAdmin;
    return false;
  };
  return {
    id: row.id,
    purpose,
    name: row.name,
    title: row.title,
    email: allowed('email') ? row.email : null,
    phone: allowed('phone') ? row.phone : null,
    about: row.about,
    responseTimeNote: row.response_time_note,
    resolvedFrom,
  };
}

export async function resolveContactsForNode(
  sql: Sql,
  nodeId: string | null,
  subject: Subject,
  viewer: Viewer,
): Promise<ResolvedContact[]> {
  const out: ResolvedContact[] = [];
  const seen = new Set<string>();

  const push = (rows: Parameters<typeof applyFieldVisibility>[0][], from: ResolvedContact['resolvedFrom'], purposes: Map<string, string>) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(applyFieldVisibility(r, viewer, purposes.get(r.id) ?? 'Who to ask', from));
    }
  };

  const selectCards = async (targetType: string, targetIds: string[]) => {
    if (targetIds.length === 0) return { rows: [], purposes: new Map<string, string>() };
    const rows = await sql<(Parameters<typeof applyFieldVisibility>[0] & { purpose: string })[]>`
      SELECT c.id, c.name, c.title, c.email, c.phone, c.about,
             c.response_time_note, c.field_visibility, b.purpose
        FROM contact_binding b
        JOIN contact_card c ON c.id = b.card_id
       WHERE b.target_type = ${targetType}
         AND b.target_id = ANY(${targetIds}::uuid[])
         AND b.archived_at IS NULL AND c.archived_at IS NULL
       ORDER BY b.sort_key, c.name`;
    return { rows, purposes: new Map(rows.map((r) => [r.id, r.purpose])) };
  };

  if (nodeId) {
    // The whole ancestry in one query, deepest first.
    const ancestry = await sql<{ id: string; level: string; depth: number }[]>`
      WITH RECURSIVE a AS (
        SELECT id, parent_id, level, depth FROM content_node WHERE id = ${nodeId}::uuid
        UNION ALL
        SELECT p.id, p.parent_id, p.level, p.depth
          FROM content_node p JOIN a ON p.id = a.parent_id
      ) SELECT id, level, depth FROM a ORDER BY depth DESC`;

    for (const level of ['page', 'topic', 'section'] as const) {
      const ids = ancestry.filter((n) => n.level === level).map((n) => n.id);
      const { rows, purposes } = await selectCards('node', ids);
      push(rows, level, purposes);
    }
  }

  if (subject.departmentId) {
    const { rows, purposes } = await selectCards('department', [subject.departmentId]);
    push(rows, 'department', purposes);
  }
  if (subject.locationId) {
    const { rows, purposes } = await selectCards('location', [subject.locationId]);
    push(rows, 'location', purposes);
  }

  if (out.length === 0) {
    const rows = await sql<Parameters<typeof applyFieldVisibility>[0][]>`
      SELECT id, name, title, email, phone, about, response_time_note, field_visibility
        FROM contact_card
       WHERE is_default_hr AND archived_at IS NULL LIMIT 1`;
    push(rows, 'default', new Map(rows.map((r) => [r.id, 'Who to ask'])));
  }

  return out;
}
