import { hasElapsed, unlockInstant } from './dates';
import type {
  AccessRule,
  ClauseName,
  Conditions,
  Decision,
  Node,
  NumericOperator,
  Subject,
} from './types';

/**
 * THE access engine.
 *
 * One pure function, one module. No database access lives in here, and no
 * caller reimplements it: the employee UI, the search query, the PDF export
 * and (when enabled) the assistant's retriever all decide access by calling
 * `evaluate`. `./sql.ts` compiles the same rule rows into a SQL predicate and
 * is property-tested against this function for agreement.
 *
 * The rules, in the order they are applied (spec §3):
 *
 *  1. The ancestor chain resolves root-first; a child may only narrow the
 *     parent. Access narrows down the tree, never widens.
 *  2. A node with no rules inherits the parent decision verbatim.
 *  3. Conditions inside a rule are ANDed; values inside a condition are ORed;
 *     an absent condition, or 'any', always matches.
 *  4. Any matching deny short-circuits to hidden, at that node or any ancestor.
 *  5. Otherwise the node is allowed if any allow rule matches, intersected
 *     with the parent's allowance.
 *  6. If every condition matches except tenure the node is LOCKED, not denied:
 *     the title, the unlock date and a one-line teaser reach the client. The
 *     body never does.
 */

const ROOT: Decision = {
  allowed: true,
  visibility: 'full',
  unlockAt: null,
  reason: { kind: 'no-rule' },
  decidedAt: null,
};

/** How one rule landed for this subject. */
type RuleOutcome =
  | { kind: 'match' }
  | { kind: 'tenure-lock'; unlockAt: Date }
  | { kind: 'no-match'; clause: ClauseName };

function matchesDimension(allowed: string[] | 'any' | undefined, actual: string | null): boolean {
  if (allowed === undefined || allowed === 'any') return true;
  if (allowed.length === 0) return true; // an emptied dropdown row means "any", not "nobody"
  if (actual === null) return false;
  return allowed.includes(actual);
}

function matchesGroups(allowed: string[] | 'any' | undefined, actual: string[]): boolean {
  if (allowed === undefined || allowed === 'any' || allowed.length === 0) return true;
  return allowed.some((id) => actual.includes(id));
}

function compare(op: NumericOperator, left: number, right: number): boolean {
  switch (op) {
    case 'gte':
      return left >= right;
    case 'gt':
      return left > right;
    case 'lte':
      return left <= right;
    case 'lt':
      return left < right;
    case 'eq':
      return left === right;
  }
}

/**
 * Evaluate one rule's conditions. Non-tenure clauses are checked first so that
 * "everything but tenure" is distinguishable from an ordinary miss — that
 * distinction is the product.
 */
function evaluateRule(conditions: Conditions, subject: Subject, at: Date): RuleOutcome {
  if (!matchesDimension(conditions.department, subject.departmentId)) {
    return { kind: 'no-match', clause: 'department' };
  }
  if (!matchesDimension(conditions.role, subject.roleId)) {
    return { kind: 'no-match', clause: 'role' };
  }
  if (!matchesDimension(conditions.employeeType, subject.employeeTypeId)) {
    return { kind: 'no-match', clause: 'employeeType' };
  }
  if (!matchesDimension(conditions.location, subject.locationId)) {
    return { kind: 'no-match', clause: 'location' };
  }
  if (!matchesGroups(conditions.group, subject.groupIds)) {
    return { kind: 'no-match', clause: 'group' };
  }
  if (conditions.hoursPerWeek) {
    const hours = subject.hoursPerWeek;
    if (hours === null || !compare(conditions.hoursPerWeek.op, hours, conditions.hoursPerWeek.value)) {
      return { kind: 'no-match', clause: 'hoursPerWeek' };
    }
  }
  if (conditions.tenure) {
    const anchor = subject.anchors[conditions.tenure.anchor];
    // No anchor date on the profile is an ordinary miss, not a lock: there is
    // no date to count from, so no unlock date could honestly be shown.
    if (!anchor) return { kind: 'no-match', clause: 'tenure' };
    if (!hasElapsed(anchor, conditions.tenure, subject.timeZone, at)) {
      return { kind: 'tenure-lock', unlockAt: unlockInstant(anchor, conditions.tenure, subject.timeZone) };
    }
  }
  return { kind: 'match' };
}

const LOCK_RANK: Record<string, number> = { hidden: 0, teaser: 1, preview: 2 };

/** Decide one node from its own rules alone, ignoring inheritance. */
function decideNode(node: Node, subject: Subject, at: Date): Decision | null {
  if (node.rules.length === 0) return null;

  const rules = [...node.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  // 4. An explicit deny at any level beats every allow.
  for (const rule of rules) {
    if (rule.effect !== 'deny') continue;
    if (evaluateRule(rule.conditions, subject, at).kind === 'match') {
      return {
        allowed: false,
        visibility: 'hidden',
        unlockAt: null,
        reason: { kind: 'rule', ruleId: rule.id, clause: 'match' },
        decidedAt: node.id,
      };
    }
  }

  const allows = rules.filter((r) => r.effect === 'allow');
  // A node carrying only denies, none of which matched, is not thereby gated.
  if (allows.length === 0) return null;

  let lock: { rule: AccessRule; unlockAt: Date } | null = null;

  for (const rule of allows) {
    const outcome = evaluateRule(rule.conditions, subject, at);
    if (outcome.kind === 'match') {
      // 5. Any matching allow is enough.
      return {
        allowed: true,
        visibility: 'full',
        unlockAt: null,
        reason: { kind: 'rule', ruleId: rule.id, clause: 'match' },
        decidedAt: node.id,
      };
    }
    if (outcome.kind === 'tenure-lock') {
      // 6. Everything but tenure matched. Prefer the earliest unlock, and among
      // equal dates the most generous locked visibility.
      const better =
        lock === null ||
        outcome.unlockAt.getTime() < lock.unlockAt.getTime() ||
        (outcome.unlockAt.getTime() === lock.unlockAt.getTime() &&
          (LOCK_RANK[rule.visibilityWhenLocked] ?? 1) > (LOCK_RANK[lock.rule.visibilityWhenLocked] ?? 1));
      if (better) lock = { rule, unlockAt: outcome.unlockAt };
    }
  }

  if (lock) {
    return {
      allowed: false,
      visibility: lock.rule.visibilityWhenLocked,
      unlockAt: lock.unlockAt,
      reason: { kind: 'rule', ruleId: lock.rule.id, clause: 'tenure' },
      decidedAt: node.id,
    };
  }

  const first = allows[0]!;
  return {
    allowed: false,
    visibility: 'hidden',
    unlockAt: null,
    reason: { kind: 'rule', ruleId: first.id, clause: 'match' },
    decidedAt: node.id,
  };
}

/**
 * Intersect a child's own decision with its parent's. A child may narrow the
 * parent; it may never widen it.
 */
function narrow(parent: Decision, child: Decision): Decision {
  if (!parent.allowed && parent.visibility === 'hidden') return parent;
  if (!child.allowed && child.visibility === 'hidden') return child;

  if (parent.allowed && child.allowed) return child;

  // At least one side is a tenure lock. The later of the two dates governs,
  // and the locked visibility is the narrower of the two.
  const parentLock = parent.unlockAt;
  const childLock = child.unlockAt;
  const unlockAt =
    parentLock && childLock
      ? new Date(Math.max(parentLock.getTime(), childLock.getTime()))
      : (parentLock ?? childLock);

  const governing =
    parentLock && childLock
      ? parentLock.getTime() >= childLock.getTime()
        ? parent
        : child
      : (parentLock ? parent : child);

  const visibility =
    (LOCK_RANK[parent.visibility] ?? 2) <= (LOCK_RANK[child.visibility] ?? 2) ? parent.visibility : child.visibility;

  return {
    allowed: false,
    visibility: visibility === 'full' ? governing.visibility : visibility,
    unlockAt,
    reason: governing.reason,
    decidedAt: governing.decidedAt,
  };
}

/**
 * Decide access for `subject` to the last node of `chain`, at instant `at`.
 * `chain` is the resolved ancestor chain, root first, ending in the target.
 */
export function evaluate(subject: Subject, chain: Node[], at: Date = new Date()): Decision {
  let decision: Decision = ROOT;

  for (const node of chain) {
    const own = decideNode(node, subject, at);
    if (own === null) {
      // 2. No rules here: inherit the parent decision verbatim.
      decision = {
        ...decision,
        reason: decision.decidedAt === null ? { kind: 'no-rule' } : { kind: 'inherited', from: decision.decidedAt },
      };
      continue;
    }
    decision = narrow(decision, own);
    if (!decision.allowed && decision.visibility === 'hidden') return decision;
  }

  return decision;
}

/** Convenience for the many call sites that only need "may this be rendered". */
export function isReadable(decision: Decision): boolean {
  return decision.allowed;
}

/** Locked, as distinct from denied: the teaser and unlock date may be shown. */
export function isLocked(decision: Decision): boolean {
  return !decision.allowed && decision.visibility !== 'hidden' && decision.unlockAt !== null;
}
