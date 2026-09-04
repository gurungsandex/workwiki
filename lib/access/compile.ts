import type { Sql } from 'postgres';
import type { Subject } from './types';
import { formatPlainDate } from './tenure';

/**
 * The SQL twin of evaluate().
 *
 * Search, export and (when enabled) assistant retrieval must filter BEFORE
 * ranking and pagination, so the rules are also expressed as a predicate that
 * runs in the same query as the content read — never as a second system that
 * mirrors permissions, which is exactly where leaks come from (spec §1).
 *
 * This is a second EXPRESSION of the same rules, and a second expression can
 * drift. Two things stop that:
 *
 *  1. tests/access/agreement.test.ts runs this against a real Postgres for
 *     hundreds of generated (subject, chain) pairs and fails the build on any
 *     disagreement with evaluate().
 *  2. Every read path re-checks with evaluate() before returning a body, so the
 *     pure function stays authoritative even if this predicate were wrong.
 *
 * Postgres `date + interval 'n months'` clamps exactly as addMonths() does
 * (2026-01-31 + 1 month = 2026-02-28), and `AT TIME ZONE` gives the same local
 * midnight instant as localMidnightUTC(). Those two agreements are what make
 * this tractable.
 */

/** Serialises the subject's anchors as a jsonb map of slug -> 'YYYY-MM-DD'. */
export function anchorsJson(subject: Subject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(subject.anchors)) out[k] = formatPlainDate(v);
  return out;
}

/**
 * Builds the CTE chain that yields one row per content node with the subject's
 * decision. Callers join their content query against `node_access`.
 *
 * `at` is the evaluation instant, passed explicitly rather than read as now(),
 * so preview-as with a simulated date uses this same predicate instead of a
 * second code path.
 *
 * Columns produced by `node_access`:
 *   node_id uuid, allowed boolean, visibility text, unlock_at timestamptz
 */
export function nodeAccessCte(sql: Sql, subject: Subject, at: Date = new Date()) {
  const dept = subject.departmentId;
  const role = subject.roleId;
  const type = subject.employeeTypeId;
  const loc = subject.locationId;
  const groups = subject.groupIds;
  const hours = subject.hoursPerWeek;
  const anchors = anchorsJson(subject);
  const tz = subject.timezone;

  return sql`
    WITH RECURSIVE
    -- Per-rule match, split into "everything except tenure" and the tenure date,
    -- because that split is what makes locked distinguishable from denied.
    rule_eval AS (
      SELECT
        r.target_id AS node_id,
        r.id        AS rule_id,
        r.effect,
        r.visibility_when_locked,
        r.priority,
        (
              (r.conditions->'departmentIds' IS NULL
                OR r.conditions->>'departmentIds' = 'any'
                OR (${dept}::uuid IS NOT NULL
                    AND jsonb_exists(r.conditions->'departmentIds', ${dept}::text)))
          AND (r.conditions->'roleIds' IS NULL
                OR r.conditions->>'roleIds' = 'any'
                OR (${role}::uuid IS NOT NULL
                    AND jsonb_exists(r.conditions->'roleIds', ${role}::text)))
          AND (r.conditions->'employeeTypeIds' IS NULL
                OR r.conditions->>'employeeTypeIds' = 'any'
                OR (${type}::uuid IS NOT NULL
                    AND jsonb_exists(r.conditions->'employeeTypeIds', ${type}::text)))
          AND (r.conditions->'locationIds' IS NULL
                OR r.conditions->>'locationIds' = 'any'
                OR (${loc}::uuid IS NOT NULL
                    AND jsonb_exists(r.conditions->'locationIds', ${loc}::text)))
          AND (r.conditions->'groupIds' IS NULL
                OR r.conditions->>'groupIds' = 'any'
                OR EXISTS (
                     SELECT 1 FROM jsonb_array_elements_text(r.conditions->'groupIds') g
                      WHERE g = ANY(${groups}::text[])))
          AND (r.conditions->'hoursPerWeek' IS NULL
                OR (${hours}::numeric IS NOT NULL AND CASE r.conditions->'hoursPerWeek'->>'op'
                      WHEN 'gte' THEN ${hours}::numeric >= (r.conditions->'hoursPerWeek'->>'value')::numeric
                      WHEN 'lte' THEN ${hours}::numeric <= (r.conditions->'hoursPerWeek'->>'value')::numeric
                      WHEN 'gt'  THEN ${hours}::numeric >  (r.conditions->'hoursPerWeek'->>'value')::numeric
                      WHEN 'lt'  THEN ${hours}::numeric <  (r.conditions->'hoursPerWeek'->>'value')::numeric
                      WHEN 'eq'  THEN ${hours}::numeric =  (r.conditions->'hoursPerWeek'->>'value')::numeric
                      ELSE false END))
        ) AS nontenure_ok,
        CASE
          WHEN r.conditions->'tenure' IS NULL THEN NULL
          WHEN (${sql.json(anchors)}::jsonb ->> (r.conditions->'tenure'->>'anchor')) IS NULL
            THEN NULL
          ELSE (
            CASE WHEN r.conditions->'tenure'->>'then' = 'first_of_next_month'
              THEN date_trunc('month',
                     ((${sql.json(anchors)}::jsonb ->> (r.conditions->'tenure'->>'anchor'))::date
                       + make_interval(
                           days   => CASE WHEN r.conditions->'tenure'->>'unit'='day'   THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           weeks  => CASE WHEN r.conditions->'tenure'->>'unit'='week'  THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           months => CASE WHEN r.conditions->'tenure'->>'unit'='month' THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           years  => CASE WHEN r.conditions->'tenure'->>'unit'='year'  THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END
                         ))::date + interval '1 month')::date
              ELSE
                     ((${sql.json(anchors)}::jsonb ->> (r.conditions->'tenure'->>'anchor'))::date
                       + make_interval(
                           days   => CASE WHEN r.conditions->'tenure'->>'unit'='day'   THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           weeks  => CASE WHEN r.conditions->'tenure'->>'unit'='week'  THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           months => CASE WHEN r.conditions->'tenure'->>'unit'='month' THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END,
                           years  => CASE WHEN r.conditions->'tenure'->>'unit'='year'  THEN (r.conditions->'tenure'->>'value')::int ELSE 0 END
                         ))::date
            END
          )
        END AS unlock_date,
        -- A tenure clause naming an anchor the subject lacks can never unlock.
        (r.conditions->'tenure' IS NOT NULL
          AND (${sql.json(anchors)}::jsonb ->> (r.conditions->'tenure'->>'anchor')) IS NULL
        ) AS tenure_unreachable
      FROM access_rule r
      WHERE r.target_type = 'node' AND r.archived_at IS NULL
    ),
    rule_scored AS (
      SELECT
        node_id, rule_id, effect, visibility_when_locked, priority, nontenure_ok,
        CASE WHEN unlock_date IS NULL THEN NULL
             ELSE (unlock_date::timestamp AT TIME ZONE ${tz}) END AS unlock_at,
        tenure_unreachable
      FROM rule_eval
    ),
    -- Per node: does a deny match, does an allow match outright, and if not,
    -- what is the soonest tenure unlock among allows that matched everything else.
    node_local AS (
      SELECT
        node_id,
        bool_or(effect = 'deny' AND nontenure_ok
                AND NOT tenure_unreachable
                AND (unlock_at IS NULL OR unlock_at <= ${at}::timestamptz)) AS has_deny,
        bool_or(effect = 'allow' AND nontenure_ok
                AND NOT tenure_unreachable
                AND (unlock_at IS NULL OR unlock_at <= ${at}::timestamptz)) AS has_allow,
        min(CASE WHEN effect = 'allow' AND nontenure_ok
                  AND NOT tenure_unreachable
                  AND unlock_at IS NOT NULL AND unlock_at > ${at}::timestamptz
                 THEN unlock_at END) AS lock_at
      FROM rule_scored
      GROUP BY node_id
    ),
    node_local_vis AS (
      SELECT
        l.node_id, l.has_deny, l.has_allow, l.lock_at,
        COALESCE((
          SELECT s.visibility_when_locked FROM rule_scored s
           WHERE s.node_id = l.node_id AND s.effect = 'allow'
             AND s.nontenure_ok AND NOT s.tenure_unreachable
             AND s.unlock_at = l.lock_at
           ORDER BY s.priority DESC LIMIT 1
        ), 'teaser') AS lock_visibility
      FROM node_local l
    ),
    -- Walk the tree root-first. A child may only narrow the parent.
    node_access AS (
      SELECT
        n.id AS node_id,
        CASE WHEN COALESCE(v.has_deny, false) THEN false
             ELSE COALESCE(v.has_allow, false) END AS allowed,
        CASE WHEN COALESCE(v.has_deny, false) THEN 'hidden'
             WHEN COALESCE(v.has_allow, false) THEN 'full'
             WHEN v.lock_at IS NOT NULL THEN v.lock_visibility
             ELSE 'hidden' END AS visibility,
        CASE WHEN COALESCE(v.has_deny, false) OR COALESCE(v.has_allow, false)
             THEN NULL ELSE v.lock_at END AS unlock_at
      FROM content_node n
      LEFT JOIN node_local_vis v ON v.node_id = n.id
      WHERE n.parent_id IS NULL

      UNION ALL

      SELECT
        c.id,
        CASE
          WHEN COALESCE(v.has_deny, false) THEN false
          WHEN NOT p.allowed AND p.unlock_at IS NULL THEN false
          WHEN v.node_id IS NULL THEN p.allowed
          WHEN NOT p.allowed THEN false
          ELSE COALESCE(v.has_allow, false)
        END,
        CASE
          WHEN COALESCE(v.has_deny, false) THEN 'hidden'
          WHEN NOT p.allowed AND p.unlock_at IS NULL THEN 'hidden'
          WHEN v.node_id IS NULL THEN p.visibility
          WHEN NOT p.allowed THEN
            CASE WHEN COALESCE(v.has_allow, false) THEN p.visibility
                 WHEN v.lock_at IS NOT NULL THEN
                   CASE WHEN v.lock_at > p.unlock_at THEN v.lock_visibility
                        ELSE p.visibility END
                 ELSE 'hidden' END
          WHEN COALESCE(v.has_allow, false) THEN 'full'
          WHEN v.lock_at IS NOT NULL THEN v.lock_visibility
          ELSE 'hidden'
        END,
        CASE
          WHEN COALESCE(v.has_deny, false) THEN NULL
          WHEN NOT p.allowed AND p.unlock_at IS NULL THEN NULL
          WHEN v.node_id IS NULL THEN p.unlock_at
          WHEN NOT p.allowed THEN
            CASE WHEN COALESCE(v.has_allow, false) THEN p.unlock_at
                 WHEN v.lock_at IS NOT NULL THEN greatest(v.lock_at, p.unlock_at)
                 ELSE NULL END
          WHEN COALESCE(v.has_allow, false) THEN NULL
          ELSE v.lock_at
        END
      FROM content_node c
      JOIN node_access p ON p.node_id = c.parent_id
      LEFT JOIN node_local_vis v ON v.node_id = c.id
    )
  `;
}
