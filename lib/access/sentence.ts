import type { RuleConditions, TenureOffset } from './types';

/**
 * Renders a rule as the plain-English sentence the admin sees. No JSON reaches
 * the admin: the condition builder is rows of dropdowns and this string.
 *
 * Pure — the caller passes the label lookups.
 */

export type Labels = {
  department: (id: string) => string;
  role: (id: string) => string;
  employeeType: (id: string) => string;
  location: (id: string) => string;
  group: (slug: string) => string;
};

function orList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

export function tenurePhrase(t: TenureOffset): string {
  const unit = t.value === 1 ? t.unit : `${t.unit}s`;
  const anchorName = t.anchor === 'hire_date' ? 'hire' : t.anchor.replace(/_/g, ' ');
  if (t.value === 0 && !t.then) return `from their first day`;
  const base = `${t.value} ${unit} after ${anchorName}`;
  return t.then === 'first_of_next_month'
    ? `from the first of the month following ${base}`
    : base;
}

export function ruleSentence(
  c: RuleConditions,
  labels: Labels,
  effect: 'allow' | 'deny' = 'allow',
): string {
  const who: string[] = [];

  const set = (
    v: string[] | 'any' | undefined,
    label: (id: string) => string,
    render: (names: string) => string,
  ) => {
    if (!v || v === 'any') return;
    if (v.length === 0) return;
    who.push(render(orList(v.map(label))));
  };

  set(c.employeeTypeIds, labels.employeeType, (n) => `${n} employees`);
  set(c.roleIds, labels.role, (n) => `in the role of ${n}`);
  set(c.departmentIds, labels.department, (n) => `in ${n}`);
  set(c.locationIds, labels.location, (n) => `at ${n}`);
  set(c.groupIds, labels.group, (n) => `in ${n}`);

  if (c.hoursPerWeek) {
    const op = {
      gte: 'at least',
      lte: 'at most',
      gt: 'more than',
      lt: 'fewer than',
      eq: 'exactly',
    }[c.hoursPerWeek.op];
    who.push(`working ${op} ${c.hoursPerWeek.value} hours a week`);
  }

  const subject = who.length === 0 ? 'Everyone' : capitalise(who.join(', '));
  const when = c.tenure ? `, ${tenurePhrase(c.tenure)}` : '';
  const verb = effect === 'deny' ? 'never sees this' : 'sees this';

  return `${subject}${when} — ${verb}.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The explain sentence the preview tool renders for one person. */
export function explainSentence(opts: {
  allowed: boolean;
  locked: boolean;
  ruleSentence: string | null;
  unlockAt: Date | null;
  timezone: string;
}): string {
  const { allowed, locked, ruleSentence: rs, unlockAt, timezone } = opts;
  if (allowed) {
    return rs
      ? `Visible to this person because of the rule "${rs.replace(/ — sees this\.$/, '')}".`
      : 'Visible to this person: it inherits from its parent.';
  }
  if (locked && unlockAt) {
    const when = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timezone,
    }).format(unlockAt);
    return rs
      ? `Locked for this person by the rule "${rs.replace(/ — sees this\.$/, '')}". Unlocks ${when}.`
      : `Locked for this person until ${when}.`;
  }
  return rs
    ? `Hidden from this person by the rule "${rs.replace(/ — (?:never )?sees this\.$/, '')}".`
    : 'Hidden from this person: no rule grants them access.';
}
