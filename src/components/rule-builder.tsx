'use client';

import { useActionState, useState } from 'react';
import { CSRF_FIELD } from '@/lib/csrf-shared';
import { emptyVocabulary, ruleSentence } from '@/lib/access/sentence';
import type { Conditions, Effect } from '@/lib/access/types';

interface Named {
  id: string;
  name: string;
}

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Rows of dropdowns compose into a rendered sentence, updated live. No JSON
 * reaches the admin — the sentence is the interface, and it is produced by the
 * same pure function the server uses when it writes the audit entry.
 */
export function RuleBuilder({
  csrf,
  action,
  targetType,
  targetId,
  departments,
  roles,
  employeeTypes,
  locations,
}: {
  csrf: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  targetType: string;
  targetId: string;
  departments: Named[];
  roles: Named[];
  employeeTypes: Named[];
  locations: Named[];
}) {
  const [state, formAction, pending] = useActionState(action, {});

  const [effect, setEffect] = useState<Effect>('allow');
  const [department, setDepartment] = useState<string[]>([]);
  const [role, setRole] = useState<string[]>([]);
  const [employeeType, setEmployeeType] = useState<string[]>([]);
  const [location, setLocation] = useState<string[]>([]);
  const [hoursOp, setHoursOp] = useState('gte');
  const [hoursValue, setHoursValue] = useState('');
  const [tenureValue, setTenureValue] = useState('');
  const [tenureUnit, setTenureUnit] = useState('day');
  const [tenureThen, setTenureThen] = useState('');
  const [lockedVisibility, setLockedVisibility] = useState('teaser');

  const vocabulary = emptyVocabulary();
  for (const row of departments) vocabulary.departments.set(row.id, row.name);
  for (const row of roles) vocabulary.roles.set(row.id, row.name);
  for (const row of employeeTypes) vocabulary.employeeTypes.set(row.id, row.name);
  for (const row of locations) vocabulary.locations.set(row.id, row.name);

  const conditions: Conditions = {};
  if (department.length) conditions.department = department;
  if (role.length) conditions.role = role;
  if (employeeType.length) conditions.employeeType = employeeType;
  if (location.length) conditions.location = location;
  if (hoursValue) conditions.hoursPerWeek = { op: hoursOp as 'gte', value: Number(hoursValue) };
  if (tenureValue && Number(tenureValue) !== 0) {
    conditions.tenure = {
      anchor: 'hire_date',
      unit: tenureUnit as 'day',
      value: Number(tenureValue),
      ...(tenureThen ? { then: 'first_of_next_month' as const } : {}),
    };
  }

  const multi = (values: string[], set: (next: string[]) => void, options: Named[], name: string, label: string, helper: string) => (
    <label className="field">
      <span>{label}</span>
      <select
        className="input"
        name={name}
        multiple
        size={Math.min(5, Math.max(2, options.length))}
        value={values}
        onChange={(event) => set([...event.target.selectedOptions].map((option) => option.value))}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <span className="helper">{helper}</span>
    </label>
  );

  return (
    <form action={formAction}>
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />

      <label className="field">
        <span>This rule</span>
        <select className="input" name="effect" value={effect} onChange={(event) => setEffect(event.target.value as Effect)}>
          <option value="allow">Lets people in</option>
          <option value="deny">Keeps people out, whatever else allows them</option>
        </select>
      </label>

      {multi(employeeType, setEmployeeType, employeeTypes, 'employeeType', 'Employee type', 'Nothing selected means any type.')}
      {multi(department, setDepartment, departments, 'department', 'Department', 'Nothing selected means any department.')}
      {multi(role, setRole, roles, 'role', 'Role', 'Nothing selected means any role.')}
      {multi(location, setLocation, locations, 'location', 'Site', 'Nothing selected means any site.')}

      <label className="field">
        <span>Hours a week</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <select className="input" name="hoursOp" value={hoursOp} onChange={(event) => setHoursOp(event.target.value)} style={{ maxWidth: 180 }}>
            <option value="gte">at least</option>
            <option value="gt">more than</option>
            <option value="lte">no more than</option>
            <option value="lt">fewer than</option>
            <option value="eq">exactly</option>
          </select>
          <input
            className="input"
            type="number"
            name="hoursValue"
            value={hoursValue}
            onChange={(event) => setHoursValue(event.target.value)}
            min={0}
            max={168}
            style={{ maxWidth: 120 }}
          />
        </span>
        <span className="helper">Leave the number blank to ignore hours.</span>
      </label>

      <label className="field">
        <span>Tenure</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            type="number"
            name="tenureValue"
            value={tenureValue}
            onChange={(event) => setTenureValue(event.target.value)}
            style={{ maxWidth: 110 }}
          />
          <select className="input" name="tenureUnit" value={tenureUnit} onChange={(event) => setTenureUnit(event.target.value)} style={{ maxWidth: 160 }}>
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
            <option value="year">years</option>
          </select>
        </span>
        <input type="hidden" name="tenureAnchor" value="hire_date" />
        <span className="helper">Counted from hire, in the person’s own site timezone. Blank means no tenure condition.</span>
      </label>

      <label className="field">
        <span>Then</span>
        <select className="input" name="tenureThen" value={tenureThen} onChange={(event) => setTenureThen(event.target.value)}>
          <option value="">on that day</option>
          <option value="first_of_next_month">from the first of the following month</option>
        </select>
      </label>

      <label className="field">
        <span>While locked, show</span>
        <select
          className="input"
          name="visibilityWhenLocked"
          value={lockedVisibility}
          onChange={(event) => setLockedVisibility(event.target.value)}
        >
          <option value="teaser">the title, the unlock date and one line</option>
          <option value="hidden">nothing at all</option>
          <option value="preview">the whole page, marked not yet active</option>
        </select>
      </label>

      <p className="notice">
        <span className="eyebrow" style={{ margin: 0 }}>
          This rule reads
        </span>
        {ruleSentence(effect, conditions, vocabulary)}
      </p>

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

      <button className="btn btn-primary" type="submit" disabled={pending || !targetId}>
        {pending ? 'Saving…' : 'Save this rule'}
      </button>
    </form>
  );
}
