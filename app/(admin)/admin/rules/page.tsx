import { sql } from '@/lib/db/client';
import { ruleSentence } from '@/lib/access/sentence';
import { parseConditions } from '@/lib/access/conditions';

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

  const [rules, labels] = await Promise.all([
    db<
      {
        id: string;
        effect: 'allow' | 'deny';
        conditions: unknown;
        visibility_when_locked: string;
        node_title: string | null;
        node_level: string | null;
      }[]
    >`
      SELECT r.id, r.effect, r.conditions, r.visibility_when_locked,
             n.title AS node_title, n.level AS node_level
        FROM access_rule r
        LEFT JOIN content_node n ON n.id = r.target_id AND r.target_type = 'node'
       WHERE r.archived_at IS NULL
       ORDER BY n.title NULLS LAST, r.effect`,
    loadLabels(db),
  ]);

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Who sees what</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Rules, as sentences</h1>
      <p className="lead" style={{ marginBottom: 30 }}>
        One evaluation engine decides every section, page and file, and it explains
        itself. No JSON, no expression language: a rule reads back in plain English.
      </p>

      {rules.length === 0 ? (
        <p className="lead" style={{ marginBottom: 40 }}>
          No rules yet — which means nothing reaches anybody. Nothing is public by
          default, so a page with no rule anywhere in its ancestry is read by nobody.
        </p>
      ) : (
        <div className="rows" style={{ marginBottom: 40 }}>
          {rules.map((r) => (
            <div key={r.id}>
              <p className="eyebrow" style={{ marginBottom: 3 }}>
                {r.node_title ?? 'Unattached'}
                {r.node_level ? ` · ${r.node_level}` : ''}
              </p>
              <p style={{ margin: '0 0 3px', fontSize: 17, maxWidth: '56ch' }}>
                {ruleSentence(safeConditions(r.conditions), labels, r.effect)}
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                While locked, show{' '}
                {r.visibility_when_locked === 'hidden'
                  ? 'nothing at all'
                  : 'the title, the unlock date and one line'}
              </p>
            </div>
          ))}
        </div>
      )}

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

async function loadLabels(db: ReturnType<typeof sql>) {
  const [departments, roles, types, locations, groups] = await Promise.all([
    db<{ id: string; name: string }[]>`SELECT id, name FROM department WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM role WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM employee_type WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM location WHERE archived_at IS NULL`,
    db<{ slug: string; name: string }[]>`SELECT slug, name FROM employee_group WHERE archived_at IS NULL`,
  ]);
  const map = (rows: { id: string; name: string }[]) =>
    new Map(rows.map((r) => [r.id, r.name]));
  const d = map(departments), r = map(roles), t = map(types), l = map(locations);
  const g = new Map(groups.map((x) => [x.slug, x.name]));
  const look = (m: Map<string, string>) => (id: string) => m.get(id) ?? 'a group that no longer exists';
  return {
    department: look(d),
    role: look(r),
    employeeType: look(t),
    location: look(l),
    group: look(g),
  };
}
