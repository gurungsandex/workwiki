import { sql } from '@/lib/db/client';
import { parseConditions } from '@/lib/access/conditions';
import { RuleBuilder, type ExistingRule, type NodeOption, type Option } from './RuleBuilder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Who sees what' };

/**
 * The rules screen.
 *
 * Rules read back as English sentences; no JSON reaches the admin. The truth
 * table below is the spec's, verbatim — and every row of it is a test in
 * tests/access/evaluate.test.ts and tests/access/sql-truth-table.test.ts.
 */
export default async function Rules() {
  const db = sql();

  const [rawRules, nodes, departments, roles, types, locations] = await Promise.all([
    db<{ id: string; targetId: string; targetTitle: string; effect: 'allow' | 'deny'; conditions: unknown; visibilityWhenLocked: string }[]>`
      SELECT r.id, r.target_id AS "targetId", n.title AS "targetTitle", r.effect,
             r.conditions, r.visibility_when_locked AS "visibilityWhenLocked"
        FROM access_rule r
        JOIN content_node n ON n.id = r.target_id
       WHERE r.archived_at IS NULL AND n.archived_at IS NULL
       ORDER BY n.depth, n.sort_key, r.effect`,
    db<NodeOption[]>`
      SELECT id, title, level, depth FROM content_node
       WHERE archived_at IS NULL ORDER BY depth, sort_key, title`,
    db<Option[]>`SELECT id, name FROM department WHERE archived_at IS NULL ORDER BY name`,
    db<Option[]>`SELECT id, name FROM role WHERE archived_at IS NULL ORDER BY name`,
    db<Option[]>`SELECT id, name FROM employee_type WHERE archived_at IS NULL ORDER BY name`,
    db<Option[]>`SELECT id, name FROM location WHERE archived_at IS NULL ORDER BY name`,
  ]);

  const rules: ExistingRule[] = rawRules.map((r) => ({
    id: r.id,
    targetId: r.targetId,
    targetTitle: r.targetTitle,
    effect: r.effect,
    conditions: safeConditions(r.conditions),
    visibilityWhenLocked: r.visibilityWhenLocked,
  }));

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Who sees what</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Build a rule as a sentence</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        No JSON, no expression language. Pick the dimensions; the rule reads back in
        plain English, with a live count of who it reaches — worked out by the same
        evaluator that decides what employees actually see.
      </p>
      <p className="note" style={{ marginBottom: 30, fontStyle: 'italic' }}>
        Nothing is public by default. A page with no allow rule anywhere in its
        ancestry is read by nobody, however finished it looks.
      </p>

      <RuleBuilder
        nodes={nodes}
        departments={departments}
        roles={roles}
        types={types}
        locations={locations}
        rules={rules}
      />

      <div style={{ height: 44 }} />

      <section>
        <h2 style={{ fontSize: 24, marginBottom: 18 }}>How it resolves, and why</h2>
        <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Rule', 'Behaviour', 'What the employee gets'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px 8px 0',
                    borderBottom: '1px solid var(--color-neutral-300)',
                    width: i === 0 ? '24%' : i === 1 ? '38%' : undefined,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['No rule on the page', 'Inherits its section', 'Whatever the section allows — never more'],
              ['Two allow rules', 'Either one matching is enough', 'Access, with the matching rule named in preview'],
              ['An explicit deny', 'Beats every allow, at any level', 'Nothing — the page is not routable for them'],
              ['Everything matches but tenure', 'Locked, not denied', 'Title, unlock date and a one-line teaser. Knowing what is coming is the point'],
              ['Parent is narrower than the child', 'The parent wins', 'Access narrows down the tree; a child can never widen it'],
            ].map(([a, b, c]) => (
              <tr key={a}>
                {[a, b, c].map((cell) => (
                  <td
                    key={cell}
                    style={{
                      padding: '11px 12px 11px 0',
                      borderTop: '1px solid var(--color-neutral-300)',
                      verticalAlign: 'top',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 20, fontStyle: 'italic' }}>
          Locked is not the same as denied. Someone who fails only the tenure condition
          still sees that the page exists and when it arrives — knowing what is coming
          is most of the value. Someone who fails a department, role, type or site
          condition sees nothing at all.
        </p>
      </section>
    </>
  );
}

function safeConditions(raw: unknown) {
  try {
    return parseConditions(raw ?? {});
  } catch {
    return {};
  }
}
