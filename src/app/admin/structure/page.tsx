import { isNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { departments, employeeTypes, locations, roles } from '@/db/schema';
import { ActionForm } from '@/components/action-form';
import { MiniForm } from '@/components/mini-form';
import { addDimension, removeDimension } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Every list on this page is a table an admin populates. Nothing here is an
 * enum, and no code path anywhere tests one of these names.
 */
export default async function StructurePage() {
  await requireAdmin();
  const csrf = await csrfToken();

  const [depts, deptRoles, types, sites] = await Promise.all([
    db.select().from(departments).where(isNull(departments.archivedAt)).orderBy(departments.name),
    db.select().from(roles).where(isNull(roles.archivedAt)).orderBy(roles.name),
    db.select().from(employeeTypes).where(isNull(employeeTypes.archivedAt)).orderBy(employeeTypes.name),
    db.select().from(locations).where(isNull(locations.archivedAt)).orderBy(locations.name),
  ]);

  return (
    <>
      <p className="eyebrow">Departments and roles</p>
      <h1 className="page-title">The vocabulary of this company</h1>
      <p className="lead">
        Nothing here shipped with the product. Every department, role, employee type and site is one you added, and every
        access rule routes by these rows.
      </p>

      <h2 className="section-heading">Departments</h2>
      {depts.length === 0 ? (
        <p className="lead">Nothing here yet. Access rules have nothing to route by until a department exists.</p>
      ) : (
        <ul className="rows">
          {depts.map((dept) => (
            <li className="row" key={dept.id}>
              <span className="meta">
                {deptRoles.filter((role) => role.departmentId === dept.id).length} role
                {deptRoles.filter((role) => role.departmentId === dept.id).length === 1 ? '' : 's'}
              </span>
              <span>
                <span className="row-title">{dept.name}</span>{' '}
                <MiniForm
                  action={removeDimension}
                  csrf={csrf}
                  hidden={{ dimension: 'department', id: dept.id }}
                  label="Remove"
                  destructive
                  confirm={`Remove “${dept.name}”? People keep their record, and rules that narrowed to it will reach wider.`}
                />
                <p className="meta" style={{ margin: '2px 0 0' }}>
                  {deptRoles
                    .filter((role) => role.departmentId === dept.id)
                    .map((role) => role.name)
                    .join(', ') || 'No roles yet.'}
                </p>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={addDimension} csrf={csrf} submitLabel="Add the department" hidden={{ dimension: 'department' }}>
        <label className="field">
          <span>New department</span>
          <input className="input" type="text" name="name" required />
          <span className="helper">The name your people already use for it.</span>
        </label>
      </ActionForm>

      <h2 className="section-heading">Roles</h2>
      <ul className="rows">
        {deptRoles.map((role) => (
          <li className="row" key={role.id}>
            <span className="meta">{depts.find((d) => d.id === role.departmentId)?.name ?? 'No department'}</span>
            <span>
              <span className="row-title">{role.name}</span>{' '}
              <MiniForm action={removeDimension} csrf={csrf} hidden={{ dimension: 'role', id: role.id }} label="Remove" destructive />
            </span>
          </li>
        ))}
      </ul>
      <ActionForm action={addDimension} csrf={csrf} submitLabel="Add the role" hidden={{ dimension: 'role' }}>
        <label className="field">
          <span>New role</span>
          <input className="input" type="text" name="name" required />
        </label>
        <label className="field">
          <span>In which department</span>
          <select className="input" name="departmentId" defaultValue="">
            <option value="">No department</option>
            {depts.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </label>
      </ActionForm>

      <h2 className="section-heading">Employee types</h2>
      <ul className="rows">
        {types.map((type) => (
          <li className="row" key={type.id}>
            <span className="meta">{type.kind}</span>
            <span>
              <span className="row-title">{type.name}</span>{' '}
              <MiniForm action={removeDimension} csrf={csrf} hidden={{ dimension: 'employee_type', id: type.id }} label="Remove" destructive />
            </span>
          </li>
        ))}
      </ul>
      <ActionForm action={addDimension} csrf={csrf} submitLabel="Add the type" hidden={{ dimension: 'employee_type' }}>
        <label className="field">
          <span>New employee type</span>
          <input className="input" type="text" name="name" required />
        </label>
        <label className="field">
          <span>Roughly which kind</span>
          <select className="input" name="kind" defaultValue="other">
            <option value="salaried">Salaried</option>
            <option value="hourly">Hourly</option>
            <option value="contingent">Contingent</option>
            <option value="other">Other</option>
          </select>
          <span className="helper">A soft hint only — it picks sensible defaults in the rule builder, nothing else.</span>
        </label>
      </ActionForm>

      <h2 className="section-heading">Sites</h2>
      <ul className="rows">
        {sites.map((site) => (
          <li className="row" key={site.id}>
            <span className="meta">{[site.region, site.country].filter(Boolean).join(', ') || '—'}</span>
            <span>
              <span className="row-title">{site.name}</span>{' '}
              <MiniForm action={removeDimension} csrf={csrf} hidden={{ dimension: 'location', id: site.id }} label="Remove" destructive />
              <p className="meta" style={{ margin: '2px 0 0' }}>
                {site.timeZone ? `Unlock dates resolve at local midnight in ${site.timeZone}.` : 'Uses the company timezone.'}
              </p>
            </span>
          </li>
        ))}
      </ul>
      <ActionForm action={addDimension} csrf={csrf} submitLabel="Add the site" hidden={{ dimension: 'location' }}>
        <label className="field">
          <span>New site</span>
          <input className="input" type="text" name="name" required />
        </label>
        <label className="field">
          <span>State or region</span>
          <input className="input" type="text" name="region" />
        </label>
        <label className="field">
          <span>Country</span>
          <input className="input" type="text" name="country" />
        </label>
        <label className="field">
          <span>Timezone</span>
          <input className="input" type="text" name="timeZone" placeholder="America/New_York" />
          <span className="helper">
            A rule must not unlock a day early for somebody on a western clock. Leave blank to use the company timezone.
          </span>
        </label>
      </ActionForm>
    </>
  );
}
