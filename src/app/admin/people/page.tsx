import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { authTokens, departments, employeeProfiles, employeeTypes, locations, roles, sessions, users } from '@/db/schema';
import { ActionForm } from '@/components/action-form';
import { MiniForm } from '@/components/mini-form';
import { InviteForm } from '@/components/invite-form';
import { addPerson, createInvite, deactivatePerson, reactivatePerson, revokeInvite, revokeOneSession, setManager } from './actions';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const admin = await requireAdmin();
  const csrf = await csrfToken();

  const [people, depts, roleRows, types, sites, invites, liveSessions] = await Promise.all([
    db
      .select({
        userId: users.id,
        email: users.email,
        status: users.status,
        isAdmin: users.isAdmin,
        name: employeeProfiles.displayName,
        department: departments.name,
        role: roles.name,
        type: employeeTypes.name,
        site: locations.name,
        hireDate: employeeProfiles.hireDate,
      })
      .from(users)
      .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
      .leftJoin(departments, eq(departments.id, employeeProfiles.departmentId))
      .leftJoin(roles, eq(roles.id, employeeProfiles.roleId))
      .leftJoin(employeeTypes, eq(employeeTypes.id, employeeProfiles.employeeTypeId))
      .leftJoin(locations, eq(locations.id, employeeProfiles.locationId))
      .where(isNull(users.archivedAt))
      .orderBy(employeeProfiles.displayName),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(isNull(departments.archivedAt)),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(isNull(roles.archivedAt)),
    db.select({ id: employeeTypes.id, name: employeeTypes.name }).from(employeeTypes).where(isNull(employeeTypes.archivedAt)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(isNull(locations.archivedAt)),
    db
      .select({ id: authTokens.id, email: authTokens.email, expiresAt: authTokens.expiresAt, consumedAt: authTokens.consumedAt })
      .from(authTokens)
      .where(and(eq(authTokens.purpose, 'invite'), isNull(authTokens.consumedAt), isNull(authTokens.revokedAt)))
      .orderBy(desc(authTokens.createdAt)),
    db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        userAgent: sessions.userAgent,
        lastSeenAt: sessions.lastSeenAt,
        name: employeeProfiles.displayName,
        email: users.email,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
      .orderBy(desc(sessions.lastSeenAt)),
  ]);

  return (
    <>
      <p className="eyebrow">People</p>
      <h1 className="page-title">The roster</h1>
      <p className="lead">
        {people.length === 1 ? 'Only you so far — generate an invite link.' : `${people.length} people, including you.`}
      </p>

      <ul className="rows">
        {people.map((person) => (
          <li className="row" key={person.userId}>
            <span className="meta">
              {person.status === 'deactivated' ? <span className="attention">Deactivated</span> : person.status}
              {person.isAdmin ? ' · admin' : ''}
            </span>
            <span>
              <span className="row-title">{person.name ?? person.email}</span>
              <p className="meta" style={{ margin: '2px 0 0' }}>
                {[person.role, person.department, person.site, person.type].filter(Boolean).join(' · ') ||
                  'No department, role, site or type yet — no rule can narrow to them.'}
                {person.hireDate ? ` · started ${new Date(person.hireDate).toLocaleDateString()}` : ''}
              </p>
              <p style={{ margin: '4px 0 0' }}>
                {person.status === 'deactivated' ? (
                  <MiniForm action={reactivatePerson} csrf={csrf} hidden={{ userId: person.userId }} label="Let them back in" />
                ) : person.userId === admin.id ? null : (
                  <MiniForm
                    action={deactivatePerson}
                    csrf={csrf}
                    hidden={{ userId: person.userId }}
                    label="Deactivate"
                    destructive
                    confirm={`Deactivate ${person.name ?? person.email}? They stop being able to sign in. What they acknowledged is kept.`}
                  />
                )}
              </p>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="section-heading">Reporting lines and open roles</h2>
      <p className="lead">
        Every change here is a hand-drawn override, and every one of them is written to the audit log. Imported lines come
        from a matched manager name; these do not.
      </p>
      <ActionForm action={setManager} csrf={csrf} submitLabel="Draw the line">
        <label className="field">
          <span>Person</span>
          <select className="input" name="userId" required>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name ?? person.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reports to</span>
          <select className="input" name="managerUserId" defaultValue="">
            <option value="">Nobody — top of their line</option>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name ?? person.email}
              </option>
            ))}
          </select>
        </label>
      </ActionForm>

      <h2 className="section-heading">Invitations</h2>
      {invites.length === 0 ? (
        <p className="lead">No invitation is outstanding.</p>
      ) : (
        <ul className="rows">
          {invites.map((invite) => (
            <li className="row" key={invite.id}>
              <span className="meta">Expires {invite.expiresAt.toLocaleDateString()}</span>
              <span>
                <span className="row-title">{invite.email ?? 'A link with no address attached'}</span>{' '}
                <MiniForm action={revokeInvite} csrf={csrf} hidden={{ id: invite.id }} label="Revoke" destructive />
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-heading">Invite somebody</h2>
      <InviteForm csrf={csrf} action={createInvite} departments={depts} roles={roleRows} employeeTypes={types} locations={sites} />

      <h2 className="section-heading">Add someone to the roster</h2>
      <p className="lead">They appear in the org chart and in rule match counts straight away, and cannot sign in until they redeem an invitation.</p>
      <ActionForm action={addPerson} csrf={csrf} submitLabel="Add them">
        <label className="field">
          <span>Name</span>
          <input className="input" type="text" name="displayName" required />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" required />
        </label>
        <label className="field">
          <span>Department</span>
          <select className="input" name="departmentId" defaultValue="">
            <option value="">Not set</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Role</span>
          <select className="input" name="roleId" defaultValue="">
            <option value="">Not set</option>
            {roleRows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Employee type</span>
          <select className="input" name="employeeTypeId" defaultValue="">
            <option value="">Not set</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Site</span>
          <select className="input" name="locationId" defaultValue="">
            <option value="">Not set</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input className="input" type="date" name="hireDate" />
          <span className="helper">Every tenure rule counts from here. Pay, date of birth and government IDs are not held anywhere in this product.</span>
        </label>
        <label className="field">
          <span>Hours a week</span>
          <input className="input" type="number" name="hoursPerWeek" min={0} max={168} step="0.5" />
        </label>
      </ActionForm>

      <h2 className="section-heading">Signed-in devices</h2>
      {liveSessions.length === 0 ? (
        <p className="lead">Nobody is signed in.</p>
      ) : (
        <ul className="rows">
          {liveSessions.map((session) => (
            <li className="row" key={session.id}>
              <span className="meta">{session.lastSeenAt.toLocaleString()}</span>
              <span>
                <span className="row-title">{session.name ?? session.email}</span>
                <p className="meta" style={{ margin: '2px 0 0' }}>{session.userAgent ?? 'An unnamed device'}</p>
                <p style={{ margin: '4px 0 0' }}>
                  <MiniForm action={revokeOneSession} csrf={csrf} hidden={{ sessionId: session.id }} label="End this session" destructive />
                </p>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
