'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SaveState, submit } from '@/components/admin/SaveState';

export type PersonRow = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  department: string | null;
  role: string | null;
  employeeType: string | null;
  location: string | null;
  hireDate: string | null;
  hasPassword: boolean;
};

type Option = { id: string; name: string };

export function PeopleEditor({
  people,
  departments,
  roles,
  types,
  locations,
}: {
  people: PersonRow[];
  departments: Option[];
  roles: Option[];
  types: Option[];
  locations: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    departmentId: '',
    roleId: '',
    employeeTypeId: '',
    locationId: '',
    hoursPerWeek: '',
    hireDate: new Date().toISOString().slice(0, 10),
  });

  async function run(url: string, init: RequestInit) {
    setSaved(null);
    setError(null);
    setLink(null);
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      link?: string;
    };
    if (!response.ok) {
      setError(data.error ?? 'That did not go through.');
      return false;
    }
    setSaved(data.message ?? null);
    if (data.link) setLink({ name: '', url: data.link });
    startTransition(() => router.refresh());
    return true;
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <SaveState saved={saved} error={error} />

      {link ? (
        <div style={{ borderLeft: '3px solid var(--color-accent)', padding: '4px 0 4px 18px', margin: '0 0 20px' }}>
          <p className="eyebrow" style={{ marginBottom: 6 }}>Their link — copy it now</p>
          <p style={{ margin: '0 0 6px', fontSize: 13.5, wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>
            {link.url}
          </p>
          <p className="note" style={{ margin: 0 }}>
            This is the only time it is shown. Only a hash of it is stored, so it cannot
            be recovered — make a new one if this is lost.
          </p>
        </div>
      ) : null}

      {people.length === 0 ? (
        <p className="lead" style={{ marginBottom: 18 }}>
          Only you so far. Add someone, then give them their link.
        </p>
      ) : (
        <div className="rows" style={{ marginBottom: 22 }}>
          {people.map((p) => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16 }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{p.displayName}</p>
                <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)' }}>
                  {[p.role, p.department, p.location, p.employeeType].filter(Boolean).join(' · ') ||
                    'No dimensions recorded — the access engine has nothing to match on'}
                </p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                  {p.email}
                  {p.hireDate ? ` · started ${p.hireDate}` : ' · no hire date, so tenure rules cannot unlock'}
                  {' · '}
                  <span
                    style={{
                      color:
                        p.status === 'active'
                          ? 'var(--color-accent-700)'
                          : 'var(--color-accent-2-700)',
                    }}
                  >
                    {p.status === 'active'
                      ? 'can sign in'
                      : p.status === 'invited'
                        ? p.hasPassword ? 'invited' : 'invited, no password set yet'
                        : 'deactivated'}
                  </span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap', alignItems: 'flex-start' }}>
                <button
                  className="inline-action"
                  type="button"
                  disabled={pending}
                  onClick={() => run(`/api/admin/people/${p.id}`, { method: 'POST', body: JSON.stringify({ action: 'invite' }) })}
                >
                  {p.hasPassword ? 'New link' : 'Invite link'}
                </button>
                <button
                  className={p.status === 'deactivated' ? 'inline-action' : 'inline-action inline-action-destructive'}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(`/api/admin/people/${p.id}`, {
                      method: 'POST',
                      body: JSON.stringify({
                        action: p.status === 'deactivated' ? 'reactivate' : 'deactivate',
                      }),
                    })
                  }
                >
                  {p.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form
          style={{ display: 'grid', gap: 16, maxWidth: 620 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run('/api/admin/people', {
              method: 'POST',
              body: JSON.stringify({
                displayName: form.displayName,
                email: form.email,
                departmentId: form.departmentId || null,
                roleId: form.roleId || null,
                employeeTypeId: form.employeeTypeId || null,
                locationId: form.locationId || null,
                hoursPerWeek: form.hoursPerWeek ? Number(form.hoursPerWeek) : null,
                hireDate: form.hireDate,
              }),
            });
            if (ok) {
              setAdding(false);
              setForm({ ...form, displayName: '', email: '' });
            }
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label className="field">
              <span className="eyebrow">Name</span>
              <input required maxLength={200} value={form.displayName} onChange={set('displayName')} />
            </label>
            <label className="field">
              <span className="eyebrow">Work email</span>
              <input type="email" required value={form.email} onChange={set('email')} />
            </label>
            <label className="field">
              <span className="eyebrow">Started</span>
              <input type="date" required value={form.hireDate} onChange={set('hireDate')} />
              <span className="helper">Every tenure rule counts from this date.</span>
            </label>
            <label className="field">
              <span className="eyebrow">Hours a week</span>
              <input type="number" min={0} max={200} value={form.hoursPerWeek} onChange={set('hoursPerWeek')} />
              <span className="helper">Optional. Some rules test it.</span>
            </label>
            <Pick label="Department" value={form.departmentId} onChange={set('departmentId')} options={departments} />
            <Pick label="Role" value={form.roleId} onChange={set('roleId')} options={roles} />
            <Pick label="Employee type" value={form.employeeTypeId} onChange={set('employeeTypeId')} options={types} />
            <Pick label="Site" value={form.locationId} onChange={set('locationId')} options={locations} />
          </div>
          <p className="note" style={{ margin: 0 }}>
            These four are what every rule is written against. A person with none of them
            recorded matches nothing but the rules that ask for nobody in particular.
          </p>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button className="btn" type="submit" disabled={pending}>Add this person</button>
            <button className="inline-action" type="button" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn" type="button" onClick={() => setAdding(true)}>Add someone</button>
      )}
    </>
  );
}

function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Option[];
}) {
  return (
    <label className="field">
      <span className="eyebrow">{label}</span>
      <select value={value} onChange={onChange}>
        <option value="">Not recorded</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}
