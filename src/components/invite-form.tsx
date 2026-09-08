'use client';

import { useActionState } from 'react';
import { CSRF_FIELD } from '@/lib/csrf-shared';

interface Named {
  id: string;
  name: string;
}

export interface FormState {
  error?: string;
  notice?: string;
  link?: string;
}

/** The link is shown once, here, so it can be handed over without email. */
export function InviteForm({
  csrf,
  action,
  departments,
  roles,
  employeeTypes,
  locations,
}: {
  csrf: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  departments: Named[];
  roles: Named[];
  employeeTypes: Named[];
  locations: Named[];
}) {
  const [state, formAction, pending] = useActionState(action, {});

  const select = (name: string, label: string, options: Named[]) => (
    <label className="field">
      <span>{label}</span>
      <select className="input" name={name} defaultValue="">
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form action={formAction}>
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" name="email" />
        <span className="helper">Leave it blank for a link you hand over yourself.</span>
      </label>
      {select('departmentId', 'Department', departments)}
      {select('roleId', 'Role', roles)}
      {select('employeeTypeId', 'Employee type', employeeTypes)}
      {select('locationId', 'Site', locations)}
      <label className="field">
        <span>Start date</span>
        <input className="input" type="date" name="hireDate" />
        <span className="helper">Tenure rules count from here, in their own site’s timezone.</span>
      </label>
      <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" name="isAdmin" />
        <span style={{ letterSpacing: 0, textTransform: 'none', fontSize: 14 }}>They administer this instance</span>
      </label>

      {state.error ? (
        <p className="notice notice-attention" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}
        </p>
      ) : null}
      {state.link ? (
        <p className="notice">
          <span className="eyebrow" style={{ margin: 0 }}>
            The link, shown once
          </span>
          <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{state.link}</code>
        </p>
      ) : null}

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Issuing…' : 'Issue the invitation'}
      </button>
    </form>
  );
}
