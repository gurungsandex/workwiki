/**
 * The access engine's vocabulary.
 *
 * This module — and every other module under lib/access/ except resolve-chain.ts
 * and compile.ts — imports nothing from lib/db, no network client, and no clock.
 * The evaluation time is the `at` parameter, never `Date.now()`. This is asserted
 * by tests/access/no-io.test.ts.
 */

/** IANA timezone identifier, e.g. "America/Los_Angeles". */
export type Timezone = string;

/** A calendar date with no time and no zone, as stored in `date` columns. */
export type PlainDate = { year: number; month: number; day: number };

export type TenureUnit = 'day' | 'week' | 'month' | 'year';

/**
 * Tenure offsets are structured, never a day count (CLAUDE.md, spec §3).
 * `then` composes AFTER the offset, not before:
 *   hire 2026-01-15, +12 months -> 2027-01-15, then first_of_next_month -> 2027-02-01.
 */
export type TenureOffset = {
  anchor: string; // slug into Subject.anchors, e.g. 'hire_date'
  unit: TenureUnit;
  value: number;
  then?: 'first_of_next_month';
};

/** A numeric comparison, used by hours_per_week (spec §3 worked example, rule R2). */
export type NumericCondition = {
  op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
  value: number;
};

/**
 * Conditions inside a rule are ANDed; values inside a condition are ORed.
 * A condition that is absent, or set to the string 'any', always matches (spec §3.3).
 */
export type RuleConditions = {
  departmentIds?: string[] | 'any';
  roleIds?: string[] | 'any';
  employeeTypeIds?: string[] | 'any';
  locationIds?: string[] | 'any';
  groupIds?: string[] | 'any';
  hoursPerWeek?: NumericCondition;
  tenure?: TenureOffset;
};

/** Which of the non-tenure clauses a rule tests. Used to name the deciding clause. */
export type ClauseName =
  | 'department'
  | 'role'
  | 'employee_type'
  | 'location'
  | 'group'
  | 'hours_per_week'
  | 'tenure';

export type RuleEffect = 'allow' | 'deny';

/**
 * `visibility` deliberately has no 'preview' member.
 *
 * The spec's Decision type lists 'preview', and the admin prototype glosses it as
 * "the whole page, marked not yet active". That contradicts spec §3 rule 6 and
 * CLAUDE.md, both of which say the body of a tenure-locked node never reaches the
 * client. The invariant wins: a locked node is 'teaser' or 'hidden', never a body.
 * See docs/PLAN.md §3.7 and docs/DECISIONS.md.
 */
export type LockedVisibility = 'hidden' | 'teaser';

export type AccessRule = {
  id: string;
  effect: RuleEffect;
  conditions: RuleConditions;
  /** What a tenure-locked subject sees. Defaults to 'teaser' (spec §3 rule 6). */
  visibilityWhenLocked?: LockedVisibility;
  priority?: number;
};

/** One level of the resolved ancestor chain, ordered root-first by the caller. */
export type ChainNode = {
  id: string;
  level: 'section' | 'topic' | 'page';
  rules: AccessRule[];
};

/**
 * The resource's resolved rule chain, root-first. The evaluator never loads this
 * itself — resolve-chain.ts does, in one query, and hands over a plain array.
 */
export type RuleChain = ChainNode[];

export type Subject = {
  userId: string;
  departmentId: string | null;
  roleId: string | null;
  employeeTypeId: string | null;
  locationId: string | null;
  groupIds: string[];
  hoursPerWeek: number | null;
  /** Anchor slug -> plain date. `hire_date` is one of these; there is no other copy. */
  anchors: Record<string, PlainDate>;
  /** The subject's location timezone; tenure unlocks at local midnight there. */
  timezone: Timezone;
};

export type DecisionReason =
  | { kind: 'rule'; ruleId: string; clause: ClauseName }
  | { kind: 'inherited'; fromNodeId: string }
  | { kind: 'no-rule' };

export type Decision = {
  allowed: boolean;
  visibility: 'full' | 'teaser' | 'hidden';
  /** Set only when the subject failed on tenure alone. */
  unlockAt: Date | null;
  reason: DecisionReason;
  /** The node in the chain that decided it — useful for the explain endpoint. */
  decidedAtNodeId: string | null;
};

/** True when a locked decision should still surface title + teaser + date. */
export function isLocked(d: Decision): boolean {
  return !d.allowed && d.unlockAt !== null && d.visibility === 'teaser';
}
