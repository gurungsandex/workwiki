import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments and roles' };

/**
 * The dimension tables, as rows. Every one of these is admin-created; the
 * platform ships with none and names none.
 */
export default async function Structure() {
  const db = sql();
  const [departments, types, locations] = await Promise.all([
    db<{ id: string; name: string; roles: string }[]>`
      SELECT d.id, d.name,
             COALESCE(string_agg(r.name, ', ' ORDER BY r.name), '') AS roles
        FROM department d
        LEFT JOIN role r ON r.department_id = d.id AND r.archived_at IS NULL
       WHERE d.archived_at IS NULL
       GROUP BY d.id, d.name ORDER BY d.name`,
    db<{ id: string; name: string; kind: string }[]>`
      SELECT id, name, kind FROM employee_type WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string; timezone: string }[]>`
      SELECT id, name, timezone FROM location WHERE archived_at IS NULL ORDER BY name`,
  ]);

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Departments and roles</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Your company&rsquo;s own words</h1>
      <p className="lead" style={{ marginBottom: 34 }}>
        Departments, roles, employee types and sites are rows you create, never a list
        this platform shipped with. Every access rule is written in these words, so
        renaming one renames it everywhere.
      </p>

      <Group
        title="Departments and their roles"
        empty="No departments yet. Every access rule needs at least one."
        rows={departments.map((d) => ({
          key: d.id,
          title: d.name,
          note: d.roles || 'No roles in this department yet.',
        }))}
      />

      <Group
        title="Employee types"
        empty="No employee types yet."
        rows={types.map((t) => ({
          key: t.id,
          title: t.name,
          note: `Treated as ${t.kind} when suggesting rule defaults. That hint is the only thing this platform assumes about it.`,
        }))}
      />

      <Group
        title="Sites"
        empty="No sites yet."
        rows={locations.map((l) => ({
          key: l.id,
          title: l.name,
          note: `Dates unlock at local midnight in ${l.timezone}.`,
        }))}
      />
    </>
  );
}

function Group({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { key: string; title: string; note: string }[];
  empty: string;
}) {
  return (
    <section style={{ marginBottom: 38 }}>
      <h2 style={{ fontSize: 24, marginBottom: 12 }}>{title}</h2>
      {rows.length === 0 ? (
        <p className="lead">{empty}</p>
      ) : (
        <div className="rows">
          {rows.map((r) => (
            <div key={r.key}>
              <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{r.title}</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '66ch' }}>
                {r.note}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
