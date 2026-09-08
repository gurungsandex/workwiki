import { describe, expect, it } from 'vitest';
import { evaluate, isLocked } from '@/lib/access/engine';
import { parseCalendarDate } from '@/lib/access/dates';
import type { AccessRule, Conditions, Node, Subject } from '@/lib/access/types';

const DEPT_CLINICAL = 'dept-clinical';
const DEPT_FIELD = 'dept-field';
const TYPE_FULL = 'type-full';
const TYPE_PART = 'type-part';
const LOC_NJ = 'loc-nj';
const LOC_NY = 'loc-ny';
const LOC_CA = 'loc-ca';

function subject(over: Partial<Subject> = {}): Subject {
  return {
    userId: 'u1',
    departmentId: DEPT_CLINICAL,
    roleId: 'role-nurse',
    employeeTypeId: TYPE_PART,
    locationId: LOC_NJ,
    anchors: { hire_date: parseCalendarDate('2026-01-15') },
    groupIds: [],
    hoursPerWeek: 24,
    timeZone: 'America/New_York',
    ...over,
  };
}

let seq = 0;
function allow(conditions: Conditions, over: Partial<AccessRule> = {}): AccessRule {
  return { id: `allow-${++seq}`, effect: 'allow', conditions, visibilityWhenLocked: 'teaser', priority: 0, ...over };
}
function deny(conditions: Conditions, over: Partial<AccessRule> = {}): AccessRule {
  return { id: `deny-${++seq}`, effect: 'deny', conditions, visibilityWhenLocked: 'hidden', priority: 0, ...over };
}
function node(id: string, rules: AccessRule[] = [], type: Node['type'] = 'page'): Node {
  return { id, type, rules };
}

const MARCH = new Date('2026-03-01T12:00:00Z');

describe('the truth table the admin console publishes', () => {
  it('no rule on the page inherits its section — whatever the section allows, never more', () => {
    const chain = [node('section', [allow({ location: [LOC_NJ] })], 'section'), node('page')];
    const d = evaluate(subject(), chain, MARCH);
    expect(d.allowed).toBe(true);
    expect(d.reason).toEqual({ kind: 'inherited', from: 'section' });
  });

  it('no rule anywhere in the chain is allowed by default — gating is opt-in', () => {
    const d = evaluate(subject(), [node('section', [], 'section'), node('page')], MARCH);
    expect(d.allowed).toBe(true);
    expect(d.reason).toEqual({ kind: 'no-rule' });
  });

  it('two allow rules: either one matching is enough', () => {
    const wrong = allow({ employeeType: [TYPE_FULL] });
    const right = allow({ employeeType: [TYPE_PART] });
    const d = evaluate(subject(), [node('page', [wrong, right])], MARCH);
    expect(d.allowed).toBe(true);
    expect(d.reason).toEqual({ kind: 'rule', ruleId: right.id, clause: 'match' });
  });

  it('an explicit deny beats every allow, at the same level', () => {
    const d = evaluate(subject(), [node('page', [allow({}), deny({ location: [LOC_NJ] })])], MARCH);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
  });

  it('an explicit deny at an ancestor beats an allow on the child', () => {
    const chain = [node('section', [deny({ department: [DEPT_CLINICAL] })], 'section'), node('page', [allow({})])];
    const d = evaluate(subject(), chain, MARCH);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.decidedAt).toBe('section');
  });

  it('a deny that does not match this subject does not gate the node', () => {
    const d = evaluate(subject(), [node('page', [deny({ location: [LOC_CA] })])], MARCH);
    expect(d.allowed).toBe(true);
  });

  it('everything matches but tenure: locked, not denied', () => {
    const rule = allow({
      employeeType: [TYPE_PART],
      hoursPerWeek: { op: 'gte', value: 20 },
      tenure: { anchor: 'hire_date', unit: 'month', value: 12, then: 'first_of_next_month' },
    });
    const d = evaluate(subject(), [node('page', [rule])], MARCH);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('teaser');
    expect(isLocked(d)).toBe(true);
    expect(d.unlockAt?.toISOString()).toBe('2027-02-01T05:00:00.000Z');
    expect(d.reason).toEqual({ kind: 'rule', ruleId: rule.id, clause: 'tenure' });
  });

  it('a non-tenure miss is denied, not locked — no unlock date is invented', () => {
    const d = evaluate(subject(), [node('page', [allow({ location: [LOC_CA] })])], MARCH);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.unlockAt).toBeNull();
    expect(isLocked(d)).toBe(false);
  });

  it('a parent narrower than the child wins — a child can never widen', () => {
    const chain = [
      node('section', [allow({ employeeType: [TYPE_FULL] })], 'section'),
      node('page', [allow({ employeeType: [TYPE_PART] })]),
    ];
    const d = evaluate(subject(), chain, MARCH);
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.decidedAt).toBe('section');
  });

  it('a child narrower than the parent also wins', () => {
    const chain = [node('section', [allow({})], 'section'), node('page', [allow({ location: [LOC_CA] })])];
    expect(evaluate(subject(), chain, MARCH).allowed).toBe(false);
  });
});

describe('the spec’s worked example', () => {
  // Part-time, Clinical Operations, New Jersey, hired 15 January, 24 h/week,
  // evaluated 1 March. Parent topic allows full- and part-time in NJ or NY.
  const topic = node('topic', [allow({ employeeType: [TYPE_FULL, TYPE_PART], location: [LOC_NJ, LOC_NY] })], 'topic');
  const r1 = allow({
    employeeType: [TYPE_FULL],
    location: [LOC_NJ, LOC_NY],
    tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
  });
  const r2 = allow({
    employeeType: [TYPE_PART],
    hoursPerWeek: { op: 'gte', value: 20 },
    tenure: { anchor: 'hire_date', unit: 'month', value: 12, then: 'first_of_next_month' },
  });
  const chain = [topic, node('page', [r1, r2])];

  it('locks on R2 with an unlock date of 1 February the following year', () => {
    const d = evaluate(subject(), chain, MARCH);
    expect(d).toMatchObject({ allowed: false, visibility: 'teaser' });
    expect(d.reason).toEqual({ kind: 'rule', ruleId: r2.id, clause: 'tenure' });
    expect(d.unlockAt?.toISOString().slice(0, 10)).toBe('2027-02-01');
  });

  it('opens on the unlock date itself, and not the instant before', () => {
    expect(evaluate(subject(), chain, new Date('2027-02-01T04:59:59Z')).allowed).toBe(false);
    expect(evaluate(subject(), chain, new Date('2027-02-01T05:00:00Z')).allowed).toBe(true);
  });

  it('lets a full-time NJ colleague past R1 after 90 days', () => {
    const colleague = subject({ employeeTypeId: TYPE_FULL, hoursPerWeek: 40 });
    expect(evaluate(colleague, chain, MARCH).allowed).toBe(false); // 90 days is 15 April
    expect(evaluate(colleague, chain, new Date('2026-04-16T12:00:00Z')).allowed).toBe(true);
  });

  it('hides it entirely from a California colleague — the topic never allowed them', () => {
    const colleague = subject({ locationId: LOC_CA, timeZone: 'America/Los_Angeles' });
    const d = evaluate(colleague, chain, MARCH);
    expect(d).toMatchObject({ allowed: false, visibility: 'hidden', unlockAt: null });
  });
});

describe('condition semantics', () => {
  it('ANDs conditions and ORs the values inside one', () => {
    const rule = allow({ department: [DEPT_CLINICAL, DEPT_FIELD], location: [LOC_NY] });
    expect(evaluate(subject(), [node('p', [rule])], MARCH).allowed).toBe(false);
    expect(evaluate(subject({ locationId: LOC_NY }), [node('p', [rule])], MARCH).allowed).toBe(true);
  });

  it('treats "any" and an emptied row as matching everyone', () => {
    expect(evaluate(subject(), [node('p', [allow({ department: 'any', role: [] })])], MARCH).allowed).toBe(true);
  });

  it('fails a dimension the subject has not been given', () => {
    const s = subject({ locationId: null });
    expect(evaluate(s, [node('p', [allow({ location: [LOC_NJ] })])], MARCH).allowed).toBe(false);
  });

  it('matches on any one of the subject’s groups', () => {
    const s = subject({ groupIds: ['g-safety', 'g-leads'] });
    expect(evaluate(s, [node('p', [allow({ group: ['g-leads'] })])], MARCH).allowed).toBe(true);
    expect(evaluate(s, [node('p', [allow({ group: ['g-other'] })])], MARCH).allowed).toBe(false);
  });

  it('compares hours per week with the stated operator', () => {
    const rule = allow({ hoursPerWeek: { op: 'gte', value: 30 } });
    expect(evaluate(subject(), [node('p', [rule])], MARCH).allowed).toBe(false);
    expect(evaluate(subject({ hoursPerWeek: 30 }), [node('p', [rule])], MARCH).allowed).toBe(true);
  });

  it('does not lock on a tenure anchor the person has no date for', () => {
    const rule = allow({ tenure: { anchor: 'benefits_eligibility_date', unit: 'day', value: 1 } });
    const d = evaluate(subject(), [node('p', [rule])], MARCH);
    expect(d).toMatchObject({ allowed: false, visibility: 'hidden', unlockAt: null });
  });

  it('reads an admin-invented anchor exactly like hire_date', () => {
    const s = subject({
      anchors: {
        hire_date: parseCalendarDate('2026-01-15'),
        transfer_date: parseCalendarDate('2026-02-01'),
      },
    });
    const reached = allow({ tenure: { anchor: 'transfer_date', unit: 'day', value: 14 } });
    expect(evaluate(s, [node('p', [reached])], MARCH).allowed).toBe(true);
    const pending = allow({ tenure: { anchor: 'transfer_date', unit: 'day', value: 30 } });
    expect(evaluate(s, [node('p', [pending])], MARCH).unlockAt?.toISOString().slice(0, 10)).toBe('2026-03-03');
  });
});

describe('locked visibility', () => {
  it('honours a rule that says show nothing at all while locked', () => {
    const rule = allow(
      { tenure: { anchor: 'hire_date', unit: 'year', value: 1 } },
      { visibilityWhenLocked: 'hidden' },
    );
    const d = evaluate(subject(), [node('p', [rule])], MARCH);
    expect(d.visibility).toBe('hidden');
    expect(isLocked(d)).toBe(false);
  });

  it('prefers the earliest unlock when two allows both lock', () => {
    const soon = allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 90 } });
    const later = allow({ tenure: { anchor: 'hire_date', unit: 'year', value: 1 } });
    const d = evaluate(subject(), [node('p', [later, soon])], MARCH);
    expect(d.reason).toEqual({ kind: 'rule', ruleId: soon.id, clause: 'tenure' });
    expect(d.unlockAt?.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('takes the later of two locks when parent and child both lock', () => {
    const chain = [
      node('section', [allow({ tenure: { anchor: 'hire_date', unit: 'year', value: 1 } })], 'section'),
      node('page', [allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 30 } })]),
    ];
    const d = evaluate(subject(), chain, MARCH);
    expect(d.allowed).toBe(false);
    expect(d.unlockAt?.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(d.decidedAt).toBe('section');
  });

  it('stays locked when the parent locks and the child allows outright', () => {
    const chain = [
      node('section', [allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 90 } })], 'section'),
      node('page', [allow({})]),
    ];
    const d = evaluate(subject(), chain, MARCH);
    expect(d).toMatchObject({ allowed: false, visibility: 'teaser' });
    expect(d.unlockAt?.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('narrows a teaser to hidden when one level says hidden', () => {
    const chain = [
      node(
        'section',
        [allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 90 } }, { visibilityWhenLocked: 'hidden' })],
        'section',
      ),
      node('page', [allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 30 } })]),
    ];
    expect(evaluate(subject(), chain, MARCH).visibility).toBe('hidden');
  });
});

describe('purity', () => {
  it('does not mutate the subject, the chain or the rules', () => {
    const s = subject();
    const rules = [allow({ department: [DEPT_CLINICAL] }), deny({ location: [LOC_CA] })];
    const chain = [node('section', rules, 'section'), node('page')];
    const before = JSON.stringify({ s, chain });
    evaluate(s, chain, MARCH);
    expect(JSON.stringify({ s, chain })).toBe(before);
  });

  it('is deterministic for the same inputs', () => {
    const s = subject();
    const chain = [node('p', [allow({ tenure: { anchor: 'hire_date', unit: 'day', value: 90 } })])];
    expect(evaluate(s, chain, MARCH)).toEqual(evaluate(s, chain, MARCH));
  });
});

describe('the sentence the admin actually reads', () => {
  it('renders a rule as English, never as JSON', async () => {
    const { emptyVocabulary, ruleSentence } = await import('@/lib/access/sentence');
    const vocabulary = emptyVocabulary();
    vocabulary.employeeTypes.set(TYPE_FULL, 'Full-time');
    vocabulary.locations.set(LOC_NJ, 'New Jersey');
    vocabulary.locations.set(LOC_NY, 'New York');

    expect(
      ruleSentence(
        'allow',
        {
          employeeType: [TYPE_FULL],
          location: [LOC_NJ, LOC_NY],
          tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
        },
        vocabulary,
      ),
    ).toBe('Full-time employees at New Jersey or New York, 90 days after hire.');
  });

  it('says plainly when a rule reaches everyone', async () => {
    const { emptyVocabulary, ruleSentence } = await import('@/lib/access/sentence');
    expect(ruleSentence('allow', {}, emptyVocabulary())).toBe('Everyone.');
  });

  it('makes a deny sound like a deny', async () => {
    const { emptyVocabulary, ruleSentence } = await import('@/lib/access/sentence');
    const vocabulary = emptyVocabulary();
    vocabulary.departments.set(DEPT_FIELD, 'Field Operations');
    expect(ruleSentence('deny', { department: [DEPT_FIELD] }, vocabulary)).toBe(
      'Everyone in Field Operations — never, whatever else allows it.',
    );
  });

  it('spells out the first-of-next-month modifier', async () => {
    const { emptyVocabulary, ruleSentence } = await import('@/lib/access/sentence');
    expect(
      ruleSentence(
        'allow',
        { hoursPerWeek: { op: 'gte', value: 20 }, tenure: { anchor: 'hire_date', unit: 'day', value: 60, then: 'first_of_next_month' } },
        emptyVocabulary(),
      ),
    ).toBe('Everyone working at least 20 hours a week, 60 days after hire, from the first of the following month.');
  });
});
