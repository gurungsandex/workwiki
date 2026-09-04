import type { AccessRule, RuleChain, Subject } from '@/lib/access/types';
import { parsePlainDate } from '@/lib/access/tenure';

/** Stable ids so failures name something readable. */
export const D = { clinical: 'dep-clinical', field: 'dep-field' };
export const R = { nurse: 'role-nurse', foreman: 'role-foreman' };
export const T = { fullTime: 'type-ft', partTime: 'type-pt' };
export const L = { nj: 'loc-nj', ny: 'loc-ny', ca: 'loc-ca' };

export function subject(over: Partial<Subject> = {}): Subject {
  return {
    userId: 'u1',
    departmentId: D.clinical,
    roleId: R.nurse,
    employeeTypeId: T.fullTime,
    locationId: L.nj,
    groupIds: [],
    hoursPerWeek: 40,
    anchors: { hire_date: parsePlainDate('2026-01-15') },
    timezone: 'America/New_York',
    ...over,
  };
}

export function allow(id: string, conditions: AccessRule['conditions'] = {}): AccessRule {
  return { id, effect: 'allow', conditions };
}

export function deny(id: string, conditions: AccessRule['conditions'] = {}): AccessRule {
  return { id, effect: 'deny', conditions };
}

export function chain(
  ...levels: { id: string; rules: AccessRule[] }[]
): RuleChain {
  const order = ['section', 'topic', 'page'] as const;
  return levels.map((l, i) => ({
    id: l.id,
    level: order[Math.min(i, 2)]!,
    rules: l.rules,
  }));
}

/** A convenient "now" that is after the 2026-01-15 hire date. */
export const MARCH_1 = new Date('2026-03-01T12:00:00Z');
