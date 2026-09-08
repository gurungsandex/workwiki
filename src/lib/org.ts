import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * The org chart. Everyone can see everyone — it is navigation, not
 * authorisation. Reporting lines come from the import's `reports_to` column
 * where it matched a name, and from admin hand-drawn overrides otherwise; the
 * footer of the screen says so.
 */

export interface OrgNode {
  id: string;
  userId: string | null;
  parentId: string | null;
  name: string | null;
  title: string | null;
  department: string | null;
  location: string | null;
  employeeType: string | null;
  onLeave: boolean;
  email: string | null;
  phone: string | null;
  lineOrigin: string;
  /** No user on the node means an unfilled position, shown as an opening. */
  isOpenRole: boolean;
}

export async function loadOrgChart(): Promise<OrgNode[]> {
  const rows = await db.execute<{
    id: string;
    user_id: string | null;
    parent_id: string | null;
    name: string | null;
    title: string | null;
    department: string | null;
    location: string | null;
    employee_type: string | null;
    on_leave: boolean | null;
    email: string | null;
    phone: string | null;
    line_origin: string;
  }>(sql`
    SELECT n.id, n.user_id, n.parent_id,
           p.display_name AS name,
           coalesce(n.title, r.name) AS title,
           coalesce(d.name, dn.name) AS department,
           coalesce(l.name, ln.name) AS location,
           et.name AS employee_type,
           p.on_leave, p.work_email AS email, p.work_phone AS phone,
           n.line_origin
    FROM org_node n
    LEFT JOIN employee_profile p ON p.user_id = n.user_id
    LEFT JOIN role r ON r.id = p.role_id
    LEFT JOIN department d ON d.id = p.department_id
    LEFT JOIN department dn ON dn.id = n.department_id
    LEFT JOIN location l ON l.id = p.location_id
    LEFT JOIN location ln ON ln.id = n.location_id
    LEFT JOIN employee_type et ON et.id = p.employee_type_id
    WHERE n.archived_at IS NULL
    ORDER BY coalesce(p.display_name, n.title, '')
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    parentId: r.parent_id,
    name: r.name,
    title: r.title,
    department: r.department,
    location: r.location,
    employeeType: r.employee_type,
    onLeave: Boolean(r.on_leave),
    email: r.email,
    phone: r.phone,
    lineOrigin: r.line_origin,
    isOpenRole: r.user_id === null,
  }));
}

export interface OrgView {
  focus: OrgNode | null;
  /** The chain above, root-first, as tappable breadcrumbs. */
  chain: OrgNode[];
  reports: OrgNode[];
  peers: OrgNode[];
  /** The whole company as an indented outline, every row tappable. */
  outline: { node: OrgNode; depth: number }[];
}

export function buildOrgView(nodes: OrgNode[], focusId: string | null): OrgView {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, OrgNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }

  const focus = (focusId && byId.get(focusId)) || null;

  const chain: OrgNode[] = [];
  let cursor = focus?.parentId ?? null;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    chain.unshift(parent);
    cursor = parent.parentId;
  }

  const reports = focus ? (children.get(focus.id) ?? []) : [];
  const peers = focus ? (children.get(focus.parentId) ?? []).filter((n) => n.id !== focus.id) : [];

  const outline: { node: OrgNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const node of children.get(parentId) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      outline.push({ node, depth });
      walk(node.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());

  return { focus, chain, reports, peers, outline };
}

/** Search matches name, title, department or site. */
export function matchesOrgQuery(node: OrgNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [node.name, node.title, node.department, node.location].some((value) =>
    (value ?? '').toLowerCase().includes(needle),
  );
}
