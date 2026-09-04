import { sql } from '@/lib/db/client';
import { PeopleEditor, type PersonRow } from './PeopleEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'People' };

export default async function People() {
  const db = sql();

  const [people, departments, roles, types, locations] = await Promise.all([
    db<PersonRow[]>`
      SELECT u.id, p.display_name AS "displayName", u.email::text AS email, u.status,
             d.name AS department, r.name AS role, t.name AS "employeeType",
             l.name AS location,
             to_char(a.date, 'YYYY-MM-DD') AS "hireDate",
             (u.password_hash IS NOT NULL) AS "hasPassword"
        FROM app_user u
        JOIN employee_profile p ON p.user_id = u.id
        LEFT JOIN department d ON d.id = p.department_id
        LEFT JOIN role r ON r.id = p.role_id
        LEFT JOIN employee_type t ON t.id = p.employee_type_id
        LEFT JOIN location l ON l.id = p.location_id
        LEFT JOIN tenure_anchor a ON a.user_id = u.id AND a.key = 'hire_date'
       WHERE u.archived_at IS NULL AND p.archived_at IS NULL
       ORDER BY u.is_admin DESC, p.display_name`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM department WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM role WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM employee_type WHERE archived_at IS NULL ORDER BY name`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM location WHERE archived_at IS NULL ORDER BY name`,
  ]);

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>People</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>Who works here</h1>
      <p className="lead" style={{ marginBottom: 14 }}>
        A person&rsquo;s department, role, employee type, site and start date are the
        whole input to the access engine. Everything they see follows from this row.
      </p>
      <p className="note" style={{ marginBottom: 32, fontStyle: 'italic' }}>
        Adding somebody does not let them in. They sign in only after redeeming an
        invite link and setting their own password — the platform never sets one for
        them, and never emails one.
      </p>

      <PeopleEditor
        people={people}
        departments={departments}
        roles={roles}
        types={types}
        locations={locations}
      />
    </>
  );
}
