import { sql } from '@/lib/db/client';
import { DimensionList, type Row } from './DimensionList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments and roles' };

/**
 * The dimension tables, as rows an admin creates.
 *
 * Every count and note on this page is a live query. Nothing here is stored as
 * a summary, and the "used by" figures come from the same tables the access
 * engine reads, so they cannot drift from what the rules actually say.
 */
export default async function Structure() {
  const db = sql();

  const [departments, roles, types, locations] = await Promise.all([
    db<{ id: string; name: string; archived: boolean; roles: string; people: string; rules: string }[]>`
      SELECT d.id, d.name, (d.archived_at IS NOT NULL) AS archived,
             (SELECT count(*) FROM role r
               WHERE r.department_id = d.id AND r.archived_at IS NULL)::text AS roles,
             (SELECT count(*) FROM employee_profile p
               WHERE p.department_id = d.id AND p.archived_at IS NULL)::text AS people,
             (SELECT count(*) FROM access_rule a
               WHERE a.archived_at IS NULL
                 AND jsonb_typeof(a.conditions -> 'departmentIds') = 'array'
                 AND jsonb_exists(a.conditions -> 'departmentIds', d.id::text))::text AS rules
        FROM department d ORDER BY d.archived_at NULLS FIRST, d.name`,

    db<{ id: string; name: string; archived: boolean; department: string | null; people: string; rules: string }[]>`
      SELECT r.id, r.name, (r.archived_at IS NOT NULL) AS archived, d.name AS department,
             (SELECT count(*) FROM employee_profile p
               WHERE p.role_id = r.id AND p.archived_at IS NULL)::text AS people,
             (SELECT count(*) FROM access_rule a
               WHERE a.archived_at IS NULL
                 AND jsonb_typeof(a.conditions -> 'roleIds') = 'array'
                 AND jsonb_exists(a.conditions -> 'roleIds', r.id::text))::text AS rules
        FROM role r LEFT JOIN department d ON d.id = r.department_id
       ORDER BY r.archived_at NULLS FIRST, r.name`,

    db<{ id: string; name: string; archived: boolean; kind: string; people: string; rules: string }[]>`
      SELECT t.id, t.name, (t.archived_at IS NOT NULL) AS archived, t.kind,
             (SELECT count(*) FROM employee_profile p
               WHERE p.employee_type_id = t.id AND p.archived_at IS NULL)::text AS people,
             (SELECT count(*) FROM access_rule a
               WHERE a.archived_at IS NULL
                 AND jsonb_typeof(a.conditions -> 'employeeTypeIds') = 'array'
                 AND jsonb_exists(a.conditions -> 'employeeTypeIds', t.id::text))::text AS rules
        FROM employee_type t ORDER BY t.archived_at NULLS FIRST, t.name`,

    db<{ id: string; name: string; archived: boolean; timezone: string; people: string; rules: string }[]>`
      SELECT l.id, l.name, (l.archived_at IS NOT NULL) AS archived, l.timezone,
             (SELECT count(*) FROM employee_profile p
               WHERE p.location_id = l.id AND p.archived_at IS NULL)::text AS people,
             (SELECT count(*) FROM access_rule a
               WHERE a.archived_at IS NULL
                 AND jsonb_typeof(a.conditions -> 'locationIds') = 'array'
                 AND jsonb_exists(a.conditions -> 'locationIds', l.id::text))::text AS rules
        FROM location l ORDER BY l.archived_at NULLS FIRST, l.name`,
  ]);

  const used = (people: string, rules: string) => {
    const p = Number(people);
    const r = Number(rules);
    const parts: string[] = [];
    parts.push(p === 1 ? '1 person' : `${p} people`);
    parts.push(r === 1 ? 'named in 1 rule' : `named in ${r} rules`);
    return parts.join(', ');
  };

  const departmentRows: Row[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
    archived: d.archived,
    note: `${used(d.people, d.rules)}, ${Number(d.roles) === 1 ? '1 role' : `${d.roles} roles`}.`,
  }));

  const roleRows: Row[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    archived: r.archived,
    note: `${r.department ? `In ${r.department}. ` : 'Not in a department. '}${used(r.people, r.rules)}.`,
  }));

  const typeRows: Row[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    archived: t.archived,
    note: `Treated as ${t.kind} when suggesting rule defaults — the only thing this platform assumes about it. ${used(t.people, t.rules)}.`,
  }));

  const locationRows: Row[] = locations.map((l) => ({
    id: l.id,
    name: l.name,
    archived: l.archived,
    note: `Dates unlock at local midnight in ${l.timezone}. ${used(l.people, l.rules)}.`,
  }));

  const liveDepartments = departments.filter((d) => !d.archived);
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Departments and roles</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Your company&rsquo;s own words</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        Departments, roles, employee types and sites are rows you create, never a list
        this platform shipped with. Every access rule is written in these words.
      </p>
      <p className="note" style={{ marginBottom: 34, fontStyle: 'italic' }}>
        Renaming is safe: rules point at the row, not the word, so they follow a rename
        without changing who sees what. Removing is refused while anybody is recorded in
        it or any rule names it — dropping it from those rules would widen them, and
        widening access is something you should do deliberately, not as the side effect
        of a delete.
      </p>

      <DimensionList
        kind="department"
        title="Departments"
        lead="The largest division of the company. Roles sit inside them."
        empty="No departments yet. Most rules start by naming one."
        rows={departmentRows}
        addLabel="New department"
      />

      <DimensionList
        kind="role"
        title="Roles"
        lead="What a person does. A role may sit inside a department, or stand alone."
        empty="No roles yet."
        rows={roleRows}
        addLabel="New role"
        extraField={
          liveDepartments.length > 0
            ? {
                name: 'departmentId',
                label: 'In which department',
                options: liveDepartments.map((d) => ({ value: d.id, label: d.name })),
              }
            : undefined
        }
      />

      <DimensionList
        kind="employee_type"
        title="Employee types"
        lead="Full-time, per-diem, seasonal, contractor — whatever your company actually uses."
        empty="No employee types yet."
        rows={typeRows}
        addLabel="New employee type"
        extraField={{
          name: 'typeKind',
          label: 'Closest shape',
          options: [
            { value: 'salaried', label: 'Salaried' },
            { value: 'hourly', label: 'Hourly' },
            { value: 'contingent', label: 'Contingent' },
            { value: 'other', label: 'Other' },
          ],
        }}
      />

      <DimensionList
        kind="location"
        title="Sites"
        lead="Where people work. A site carries its own timezone, and tenure unlocks at local midnight there."
        empty="No sites yet."
        rows={locationRows}
        addLabel="New site"
        extraField={{
          name: 'timezone',
          label: 'Timezone',
          options: zones.map((z) => ({ value: z, label: z })),
        }}
      />
    </>
  );
}
