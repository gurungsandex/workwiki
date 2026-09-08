import { describeOffset } from './dates';
import type { Conditions, Effect, LockedVisibility } from './types';

/**
 * The condition builder renders rows of dropdowns as a live sentence. No JSON
 * ever reaches the admin — this module is where the sentence comes from, and it
 * is pure so the same string can be tested, printed and shown in preview.
 */

export interface Vocabulary {
  departments: Map<string, string>;
  roles: Map<string, string>;
  employeeTypes: Map<string, string>;
  locations: Map<string, string>;
  groups: Map<string, string>;
  anchors: Map<string, string>;
}

export function emptyVocabulary(): Vocabulary {
  return {
    departments: new Map(),
    roles: new Map(),
    employeeTypes: new Map(),
    locations: new Map(),
    groups: new Map(),
    anchors: new Map([['hire_date', 'hire']]),
  };
}

function names(ids: string[] | 'any' | undefined, lookup: Map<string, string>): string | null {
  if (!ids || ids === 'any' || ids.length === 0) return null;
  const labels = ids.map((id) => lookup.get(id) ?? 'something removed');
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

const OPERATOR_WORDS: Record<string, string> = {
  gte: 'at least',
  gt: 'more than',
  lte: 'no more than',
  lt: 'fewer than',
  eq: 'exactly',
};

/**
 * "Full-time employees in NJ or NY, 90 days after hire."
 * A rule with no conditions reads as everyone, because that is what it does.
 */
export function ruleSentence(effect: Effect, conditions: Conditions, vocabulary: Vocabulary): string {
  const type = names(conditions.employeeType, vocabulary.employeeTypes);
  const role = names(conditions.role, vocabulary.roles);
  const department = names(conditions.department, vocabulary.departments);
  const location = names(conditions.location, vocabulary.locations);
  const group = names(conditions.group, vocabulary.groups);

  const who: string[] = [];
  who.push(type ? `${type} employees` : 'Everyone');
  if (role) who.push(`working as ${role}`);
  if (department) who.push(`in ${department}`);
  if (location) who.push(`at ${location}`);
  if (group) who.push(`in ${group}`);
  if (conditions.hoursPerWeek) {
    who.push(`working ${OPERATOR_WORDS[conditions.hoursPerWeek.op] ?? ''} ${conditions.hoursPerWeek.value} hours a week`.replace('  ', ' '));
  }

  let sentence = who.join(' ');
  if (conditions.tenure) {
    const anchorLabel = vocabulary.anchors.get(conditions.tenure.anchor) ?? conditions.tenure.anchor.replace(/_/g, ' ');
    sentence += `, ${describeOffset(conditions.tenure, anchorLabel)}`;
  }

  return effect === 'deny' ? `${sentence} — never, whatever else allows it.` : `${sentence}.`;
}

const LOCKED_WORDS: Record<LockedVisibility, string> = {
  hidden: 'nothing at all',
  teaser: 'the title, the unlock date and one line',
  preview: 'the whole page, marked not yet active',
};

export function lockedExplainer(conditions: Conditions, visibility: LockedVisibility): string | null {
  if (!conditions.tenure) return null;
  return `Before that date they see ${LOCKED_WORDS[visibility]}.`;
}

/** The sentence the preview tool renders from an evaluator decision. */
export function explainDecision(input: {
  allowed: boolean;
  visibility: string;
  unlockAt: Date | null;
  ruleSentence: string | null;
  clause: string | null;
  inherited: boolean;
}): string {
  if (input.allowed) {
    return input.ruleSentence
      ? `Allowed by the rule “${input.ruleSentence}”`
      : input.inherited
        ? 'Allowed, inherited from the section above it.'
        : 'Allowed — no rule narrows this, so everyone published to sees it.';
  }
  if (input.unlockAt && input.visibility !== 'hidden') {
    return `Locked for this person by the rule “${input.ruleSentence ?? '—'}”. Unlocks ${input.unlockAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`;
  }
  if (input.clause === 'match' && input.ruleSentence) {
    return `Not routable for this person: “${input.ruleSentence}”`;
  }
  return 'Not routable for this person — nothing allows it at this level or above.';
}
