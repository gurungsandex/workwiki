import { describe, it, expect } from 'vitest';
import { evaluate } from '@/lib/access/evaluate';
import type { AccessRule } from '@/lib/access/types';
import { parsePlainDate } from '@/lib/access/tenure';
import { allow, chain, D, deny, L, MARCH_1, R, subject, T } from './fixtures';

/**
 * The five rows of the admin console's "Who sees what" tab, as a table.
 * Admin Console.dc.html lines 1402-1406.
 */
describe('truth table: how it resolves, and why', () => {
  it('row 1 — no rule on the page inherits its section, and never more', () => {
    const c = chain(
      { id: 'sec', rules: [allow('A1', { locationIds: [L.nj] })] },
      { id: 'page', rules: [] },
    );
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(true);
    expect(d.visibility).toBe('full');
    expect(d.reason).toEqual({ kind: 'inherited', fromNodeId: 'sec' });
  });

  it('row 1b — inheriting a denial is still a denial', () => {
    const c = chain(
      { id: 'sec', rules: [allow('A1', { locationIds: [L.ca] })] },
      { id: 'page', rules: [] },
    );
    const d = evaluate(subject({ locationId: L.nj }), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
  });

  it('row 2 — two allow rules: either one matching is enough', () => {
    const c = chain({
      id: 'page',
      rules: [
        allow('A1', { employeeTypeIds: [T.partTime] }), // does not match
        allow('A2', { employeeTypeIds: [T.fullTime] }), // matches
      ],
    });
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(true);
    // The matching rule is named, so preview can render it.
    expect(d.reason).toEqual({ kind: 'rule', ruleId: 'A2', clause: 'employee_type' });
  });

  it('row 3 — an explicit deny beats every allow, on the same node', () => {
    const c = chain({
      id: 'page',
      rules: [allow('A1', {}), deny('X1', { locationIds: [L.nj] })],
    });
    const d = evaluate(subject({ locationId: L.nj }), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.reason).toEqual({ kind: 'rule', ruleId: 'X1', clause: 'location' });
  });

  it('row 3b — a deny on an ANCESTOR beats an allow on the child', () => {
    const c = chain(
      { id: 'sec', rules: [deny('X1', { departmentIds: [D.clinical] })] },
      { id: 'page', rules: [allow('A1', {})] },
    );
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.decidedAtNodeId).toBe('sec');
  });

  it('row 3c — a deny on a DESCENDANT beats an allow on the parent', () => {
    const c = chain(
      { id: 'sec', rules: [allow('A1', {})] },
      { id: 'page', rules: [deny('X1', { roleIds: [R.nurse] })] },
    );
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.decidedAtNodeId).toBe('page');
  });

  it('row 4 — everything matches but tenure is LOCKED, not denied', () => {
    const rule: AccessRule = {
      id: 'A1',
      effect: 'allow',
      conditions: {
        employeeTypeIds: [T.fullTime],
        locationIds: [L.nj],
        tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
      },
    };
    const d = evaluate(subject(), chain({ id: 'page', rules: [rule] }), MARCH_1);

    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('teaser'); // title + unlock date + one line
    expect(d.unlockAt).not.toBeNull();
    // 2026-01-15 + 90 days = 2026-04-15, local midnight in New York.
    expect(d.unlockAt!.toISOString()).toBe('2026-04-15T04:00:00.000Z');
    expect(d.reason).toEqual({ kind: 'rule', ruleId: 'A1', clause: 'tenure' });
  });

  it('row 4b — failing a NON-tenure condition is hidden, not locked', () => {
    const rule: AccessRule = {
      id: 'A1',
      effect: 'allow',
      conditions: {
        employeeTypeIds: [T.partTime], // subject is full-time
        tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
      },
    };
    const d = evaluate(subject(), chain({ id: 'page', rules: [rule] }), MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.unlockAt).toBeNull();
  });

  it('row 4c — a rule may choose to hide rather than tease while locked', () => {
    const rule: AccessRule = {
      id: 'A1',
      effect: 'allow',
      visibilityWhenLocked: 'hidden',
      conditions: { tenure: { anchor: 'hire_date', unit: 'day', value: 90 } },
    };
    const d = evaluate(subject(), chain({ id: 'page', rules: [rule] }), MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.unlockAt).not.toBeNull(); // the date is still known
  });

  it('row 4d — the soonest unlock wins when two tenure rules both lock', () => {
    const c = chain({
      id: 'page',
      rules: [
        allow('A1', { tenure: { anchor: 'hire_date', unit: 'year', value: 1 } }),
        allow('A2', { tenure: { anchor: 'hire_date', unit: 'day', value: 90 } }),
      ],
    });
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.unlockAt!.toISOString()).toBe('2026-04-15T04:00:00.000Z'); // the 90-day one
    expect(d.reason).toEqual({ kind: 'rule', ruleId: 'A2', clause: 'tenure' });
  });

  it('row 5 — a parent narrower than the child: the parent wins', () => {
    const c = chain(
      { id: 'sec', rules: [allow('A1', { locationIds: [L.nj] })] },
      { id: 'page', rules: [allow('A2', {})] }, // wide open on its own
    );
    // A NY employee is allowed by the child's rule but excluded by the parent.
    const d = evaluate(subject({ locationId: L.ny }), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.decidedAtNodeId).toBe('sec');
  });

  it('row 5b — a child can narrow a parent', () => {
    const c = chain(
      { id: 'sec', rules: [allow('A1', {})] },
      { id: 'page', rules: [allow('A2', { locationIds: [L.ca] })] },
    );
    expect(evaluate(subject({ locationId: L.nj }), c, MARCH_1).allowed).toBe(false);
    expect(evaluate(subject({ locationId: L.ca }), c, MARCH_1).allowed).toBe(true);
  });

  it('row 5c — a locked parent locks the child even when the child is open', () => {
    const c = chain(
      {
        id: 'sec',
        rules: [allow('A1', { tenure: { anchor: 'hire_date', unit: 'day', value: 90 } })],
      },
      { id: 'page', rules: [allow('A2', {})] },
    );
    const d = evaluate(subject(), c, MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('teaser');
    expect(d.unlockAt!.toISOString()).toBe('2026-04-15T04:00:00.000Z');
  });
});

describe('the spec §3 worked example, asserted exactly', () => {
  it('part-time NJ clinical hire, 24h/week, evaluated 1 March', () => {
    const parentTopic = allow('P1', {
      employeeTypeIds: [T.fullTime, T.partTime],
      locationIds: [L.nj, L.ny],
    });
    const R1: AccessRule = {
      id: 'R1',
      effect: 'allow',
      visibilityWhenLocked: 'teaser',
      conditions: {
        employeeTypeIds: [T.fullTime],
        locationIds: [L.nj, L.ny],
        tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
      },
    };
    const R2: AccessRule = {
      id: 'R2',
      effect: 'allow',
      visibilityWhenLocked: 'teaser',
      conditions: {
        employeeTypeIds: [T.partTime],
        hoursPerWeek: { op: 'gte', value: 20 },
        tenure: {
          anchor: 'hire_date',
          unit: 'month',
          value: 12,
          then: 'first_of_next_month',
        },
      },
    };

    const s = subject({
      employeeTypeId: T.partTime,
      hoursPerWeek: 24,
      anchors: { hire_date: parsePlainDate('2026-01-15') },
    });
    const c = chain(
      { id: 'topic-retirement', rules: [parentTopic] },
      { id: 'page-enrolment', rules: [R1, R2] },
    );

    const d = evaluate(s, c, MARCH_1);

    // R1: employee_type fails -> discarded, no lock.
    // R2: type matches, hours match (24 >= 20), tenure fails.
    //     15 Jan + 12 months = 15 Jan next year, then first of next month = 1 Feb.
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('teaser');
    expect(d.unlockAt!.toISOString()).toBe('2027-02-01T05:00:00.000Z');
    expect(d.reason).toEqual({ kind: 'rule', ruleId: 'R2', clause: 'tenure' });
  });
});

describe('condition semantics', () => {
  it('conditions inside a rule are ANDed', () => {
    const c = chain({
      id: 'page',
      rules: [allow('A1', { departmentIds: [D.clinical], locationIds: [L.ca] })],
    });
    expect(evaluate(subject({ locationId: L.nj }), c, MARCH_1).allowed).toBe(false);
  });

  it('values inside a condition are ORed', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { locationIds: [L.nj, L.ny] })] });
    expect(evaluate(subject({ locationId: L.nj }), c, MARCH_1).allowed).toBe(true);
    expect(evaluate(subject({ locationId: L.ny }), c, MARCH_1).allowed).toBe(true);
    expect(evaluate(subject({ locationId: L.ca }), c, MARCH_1).allowed).toBe(false);
  });

  it('an omitted condition always matches', () => {
    const c = chain({ id: 'page', rules: [allow('A1', {})] });
    expect(evaluate(subject({ departmentId: null }), c, MARCH_1).allowed).toBe(true);
  });

  it('a condition set to "any" always matches', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { departmentIds: 'any' })] });
    expect(evaluate(subject({ departmentId: null }), c, MARCH_1).allowed).toBe(true);
  });

  it('an empty value list matches nothing (an unfinished rule grants nothing)', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { locationIds: [] })] });
    expect(evaluate(subject(), c, MARCH_1).allowed).toBe(false);
  });

  it('a null subject dimension cannot match a list condition', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { departmentIds: [D.clinical] })] });
    expect(evaluate(subject({ departmentId: null }), c, MARCH_1).allowed).toBe(false);
  });

  it('groups are ORed like any other dimension', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { groupIds: ['g1', 'g2'] })] });
    expect(evaluate(subject({ groupIds: ['g2'] }), c, MARCH_1).allowed).toBe(true);
    expect(evaluate(subject({ groupIds: ['g9'] }), c, MARCH_1).allowed).toBe(false);
  });

  it('hoursPerWeek is a numeric comparison, not set membership', () => {
    const c = chain({
      id: 'page',
      rules: [allow('A1', { hoursPerWeek: { op: 'gte', value: 20 } })],
    });
    expect(evaluate(subject({ hoursPerWeek: 24 }), c, MARCH_1).allowed).toBe(true);
    expect(evaluate(subject({ hoursPerWeek: 20 }), c, MARCH_1).allowed).toBe(true);
    expect(evaluate(subject({ hoursPerWeek: 19 }), c, MARCH_1).allowed).toBe(false);
    expect(evaluate(subject({ hoursPerWeek: null }), c, MARCH_1).allowed).toBe(false);
  });
});

describe('no rules anywhere', () => {
  it('a chain with no rules at all is not allowed — nothing is public by default', () => {
    const d = evaluate(subject(), chain({ id: 'page', rules: [] }), MARCH_1);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.reason).toEqual({ kind: 'no-rule' });
  });
});

describe('purity', () => {
  it('is deterministic for the same inputs', () => {
    const c = chain({ id: 'page', rules: [allow('A1', { locationIds: [L.nj] })] });
    const a = evaluate(subject(), c, MARCH_1);
    const b = evaluate(subject(), c, MARCH_1);
    expect(a).toEqual(b);
  });

  it('does not mutate its inputs', () => {
    const s = subject();
    const c = chain({ id: 'page', rules: [allow('A1', {})] });
    const sBefore = structuredClone(s);
    const cBefore = structuredClone(c);
    evaluate(s, c, MARCH_1);
    expect(s).toEqual(sBefore);
    expect(c).toEqual(cBefore);
  });

  it('the decision depends on `at`, not on the wall clock', () => {
    const c = chain({
      id: 'page',
      rules: [allow('A1', { tenure: { anchor: 'hire_date', unit: 'day', value: 90 } })],
    });
    expect(evaluate(subject(), c, new Date('2026-03-01T12:00:00Z')).allowed).toBe(false);
    expect(evaluate(subject(), c, new Date('2026-05-01T12:00:00Z')).allowed).toBe(true);
  });
});
