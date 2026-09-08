import { type SQL, sql } from 'drizzle-orm';
import { hasElapsed, type Offset } from './dates';
import type { Conditions, Subject } from './types';

/**
 * The access filter as a SQL predicate.
 *
 * Search, export and (when enabled) the assistant's retriever must not fetch
 * rows and then drop them: the filter belongs *inside* the query. This module
 * compiles the same `access_rule` rows the evaluator reads into that predicate,
 * and `tests/access-sql.test.ts` property-tests it against `evaluate` for
 * agreement on randomly generated rule shapes.
 *
 * Tenure is the one clause that is not re-implemented here. Date arithmetic
 * lives in exactly one place (`./dates.ts`); duplicating month clamping and
 * timezone handling in SQL is how a wrong eligibility date gets shipped. So a
 * caller first resolves which rules the subject satisfies on tenure — one small
 * query, then `tenureSatisfiedRuleIds` — and the predicate treats that as given.
 */

export interface TenureRuleRow {
  id: string;
  conditions: Conditions | null;
}

/** Which of these rules does the subject satisfy on tenure alone? */
export function tenureSatisfiedRuleIds(rules: TenureRuleRow[], subject: Subject, at: Date): string[] {
  const satisfied: string[] = [];
  for (const rule of rules) {
    const tenure = rule.conditions?.tenure as Offset | undefined;
    if (!tenure) {
      satisfied.push(rule.id);
      continue;
    }
    const anchor = subject.anchors[tenure.anchor];
    if (anchor && hasElapsed(anchor, tenure, subject.timeZone, at)) satisfied.push(rule.id);
  }
  return satisfied;
}

function dimensionMatches(key: string, value: string | null): SQL {
  const column = sql.raw(`ar.conditions -> '${key}'`);
  const asText = sql.raw(`ar.conditions ->> '${key}'`);
  return sql`(
    ${column} IS NULL
    OR ${asText} = 'any'
    OR jsonb_typeof(${column}) <> 'array'
    OR jsonb_array_length(${column}) = 0
    OR (${value}::text IS NOT NULL AND ${column} ? ${value}::text)
  )`;
}

function groupMatches(groupIds: string[]): SQL {
  const column = sql.raw("ar.conditions -> 'group'");
  const asText = sql.raw("ar.conditions ->> 'group'");
  return sql`(
    ${column} IS NULL
    OR ${asText} = 'any'
    OR jsonb_typeof(${column}) <> 'array'
    OR jsonb_array_length(${column}) = 0
    OR ${column} ?| ${sql.param(groupIds)}::text[]
  )`;
}

function hoursMatch(hoursPerWeek: number | null): SQL {
  const clause = sql.raw("ar.conditions -> 'hoursPerWeek'");
  const op = sql.raw("ar.conditions -> 'hoursPerWeek' ->> 'op'");
  const value = sql.raw("(ar.conditions -> 'hoursPerWeek' ->> 'value')::numeric");
  const hours = sql`${hoursPerWeek}::numeric`;
  return sql`(
    ${clause} IS NULL
    OR (
      ${hours} IS NOT NULL
      AND CASE ${op}
        WHEN 'gte' THEN ${hours} >= ${value}
        WHEN 'gt'  THEN ${hours} >  ${value}
        WHEN 'lte' THEN ${hours} <= ${value}
        WHEN 'lt'  THEN ${hours} <  ${value}
        WHEN 'eq'  THEN ${hours} =  ${value}
        ELSE false
      END
    )
  )`;
}

/** Every clause of a rule matched — tenure included, by way of the id list. */
function ruleMatches(subject: Subject, tenureOk: string[]): SQL {
  return sql`(
    ${dimensionMatches('department', subject.departmentId)}
    AND ${dimensionMatches('role', subject.roleId)}
    AND ${dimensionMatches('employeeType', subject.employeeTypeId)}
    AND ${dimensionMatches('location', subject.locationId)}
    AND ${groupMatches(subject.groupIds)}
    AND ${hoursMatch(subject.hoursPerWeek)}
    AND ar.id = ANY(${sql.param(tenureOk)}::uuid[])
  )`;
}

/**
 * True when the node identified by `targetType`/`targetIdExpr` is *fully*
 * allowed for the subject — not denied, and satisfying an allow rule if the
 * node carries any. Locked nodes are excluded, which is what search wants:
 * a locked page is reachable by browsing as a teaser, never as a search hit
 * with a body.
 */
export function nodeAllowedSql(
  subject: Subject,
  tenureOk: string[],
  targetType: 'section' | 'topic' | 'page',
  targetIdExpr: SQL,
): SQL {
  const live = sql`ar.archived_at IS NULL AND ar.target_type = ${targetType} AND ar.target_id = ${targetIdExpr}`;
  const matches = ruleMatches(subject, tenureOk);
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM access_rule ar
      WHERE ${live} AND ar.effect = 'deny' AND ${matches}
    )
    AND (
      NOT EXISTS (SELECT 1 FROM access_rule ar WHERE ${live} AND ar.effect = 'allow')
      OR EXISTS (
        SELECT 1 FROM access_rule ar
        WHERE ${live} AND ar.effect = 'allow' AND ${matches}
      )
    )
  )`;
}

/**
 * The whole ancestor chain, root-first, as one predicate: a page is readable
 * only if its section, its topic and the page itself each allow the subject.
 * Access narrows down the tree; this is that rule, in SQL.
 */
export function pageReadableSql(
  subject: Subject,
  tenureOk: string[],
  columns: { sectionId: SQL; topicId: SQL; pageId: SQL },
): SQL {
  return sql`(
    ${nodeAllowedSql(subject, tenureOk, 'section', columns.sectionId)}
    AND ${nodeAllowedSql(subject, tenureOk, 'topic', columns.topicId)}
    AND ${nodeAllowedSql(subject, tenureOk, 'page', columns.pageId)}
  )`;
}
