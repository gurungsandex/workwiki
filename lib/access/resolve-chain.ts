import type { Sql } from 'postgres';
import type { AccessRule, RuleChain, Subject } from './types';
import { parseConditions } from './conditions';
import { parsePlainDate } from './tenure';

/**
 * The database boundary for the access engine.
 *
 * Resolves a node's ancestor chain root-first in ONE recursive query, regardless
 * of depth, and hands the evaluator a plain array. The evaluator itself never
 * touches a database.
 */
export async function resolveChain(sql: Sql, nodeId: string): Promise<RuleChain> {
  const rows = await sql<
    {
      id: string;
      level: 'section' | 'topic' | 'page';
      depth: number;
      rule_id: string | null;
      effect: 'allow' | 'deny' | null;
      conditions: unknown;
      visibility_when_locked: 'hidden' | 'teaser' | null;
      priority: number | null;
    }[]
  >`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, level, depth FROM content_node WHERE id = ${nodeId}::uuid
      UNION ALL
      SELECT p.id, p.parent_id, p.level, p.depth
        FROM content_node p JOIN ancestry a ON p.id = a.parent_id
    )
    SELECT a.id, a.level, a.depth,
           r.id AS rule_id, r.effect, r.conditions,
           r.visibility_when_locked, r.priority
      FROM ancestry a
      LEFT JOIN access_rule r
        ON r.target_type = 'node' AND r.target_id = a.id AND r.archived_at IS NULL
     ORDER BY a.depth ASC, r.priority DESC NULLS LAST, r.id ASC`;

  const byNode = new Map<string, { level: 'section' | 'topic' | 'page'; rules: AccessRule[] }>();
  const order: string[] = [];

  for (const row of rows) {
    let entry = byNode.get(row.id);
    if (!entry) {
      entry = { level: row.level, rules: [] };
      byNode.set(row.id, entry);
      order.push(row.id);
    }
    if (row.rule_id && row.effect) {
      entry.rules.push({
        id: row.rule_id,
        effect: row.effect,
        conditions: parseConditions(row.conditions ?? {}),
        visibilityWhenLocked: row.visibility_when_locked ?? 'teaser',
        priority: row.priority ?? 0,
      });
    }
  }

  // Root-first: the recursive query already orders by depth ascending.
  return order.map((id) => ({ id, level: byNode.get(id)!.level, rules: byNode.get(id)!.rules }));
}

/**
 * Loads the evaluator's Subject for a user. Every access dimension resolves
 * from the profile row, plus the anchors and group memberships.
 */
export async function loadSubject(sql: Sql, userId: string): Promise<Subject | null> {
  const [profile] = await sql<
    {
      user_id: string;
      department_id: string | null;
      role_id: string | null;
      employee_type_id: string | null;
      location_id: string | null;
      hours_per_week: string | null;
      timezone: string | null;
    }[]
  >`
    SELECT p.user_id, p.department_id, p.role_id, p.employee_type_id,
           p.location_id, p.hours_per_week,
           COALESCE(l.timezone, c.timezone, 'UTC') AS timezone
      FROM employee_profile p
      LEFT JOIN location l ON l.id = p.location_id
      LEFT JOIN company_setting c ON c.singleton
     WHERE p.user_id = ${userId}::uuid AND p.archived_at IS NULL`;

  if (!profile) return null;

  const anchorRows = await sql<{ key: string; date: string }[]>`
    SELECT key, to_char(date, 'YYYY-MM-DD') AS date
      FROM tenure_anchor WHERE user_id = ${userId}::uuid`;

  const groupRows = await sql<{ slug: string }[]>`
    SELECT g.slug FROM employee_group_member m
      JOIN employee_group g ON g.id = m.group_id
     WHERE m.user_id = ${userId}::uuid AND g.archived_at IS NULL`;

  const anchors: Subject['anchors'] = {};
  for (const r of anchorRows) anchors[r.key] = parsePlainDate(r.date);

  return {
    userId: profile.user_id,
    departmentId: profile.department_id,
    roleId: profile.role_id,
    employeeTypeId: profile.employee_type_id,
    locationId: profile.location_id,
    groupIds: groupRows.map((r) => r.slug),
    hoursPerWeek: profile.hours_per_week === null ? null : Number(profile.hours_per_week),
    anchors,
    timezone: profile.timezone ?? 'UTC',
  };
}
