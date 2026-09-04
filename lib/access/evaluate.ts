import type {
  AccessRule,
  ClauseName,
  Decision,
  DecisionReason,
  LockedVisibility,
  NumericCondition,
  RuleChain,
  RuleConditions,
  Subject,
} from './types';
import { tenureSatisfied, unlockInstant } from './tenure';

/**
 * THE access engine. One pure function, one module.
 *
 * Nothing else in the codebase reads access_rule. The UI, the search query, the
 * PDF export and (when enabled) the assistant's retriever all call this — search
 * and retrieval by way of the SQL predicate in compile.ts, which is property-tested
 * for agreement with this function.
 *
 * No database access, no network, no clock: `at` is the evaluation time.
 *
 * Evaluation order (spec §3):
 *  1. Resolve the ancestor chain root-first; a child may only narrow the parent.
 *  2. A node with no rules inherits the parent decision verbatim.
 *  3. Conditions inside a rule are ANDed; values inside a condition are ORed.
 *  4. Any matching deny short-circuits to hidden, at that node or any ancestor.
 *  5. Otherwise the node is allowed if any allow rule matches, intersected with
 *     the parent's allowance.
 *  6. Matching everything except tenure is LOCKED, not denied.
 */
export function evaluate(subject: Subject, chain: RuleChain, at: Date): Decision {
  // Nothing is public by default: an empty chain grants nothing.
  let current: Decision = {
    allowed: false,
    visibility: 'hidden',
    unlockAt: null,
    reason: { kind: 'no-rule' },
    decidedAtNodeId: null,
  };

  let isRoot = true;

  for (const node of chain) {
    // (2) No rules: inherit the parent decision verbatim.
    if (node.rules.length === 0) {
      if (isRoot) {
        // A root with no rules grants nothing; it does not open the tree.
        current = {
          allowed: false,
          visibility: 'hidden',
          unlockAt: null,
          reason: { kind: 'no-rule' },
          decidedAtNodeId: null,
        };
      } else if (current.decidedAtNodeId !== null) {
        current = {
          ...current,
          reason: { kind: 'inherited', fromNodeId: current.decidedAtNodeId },
        };
      }
      isRoot = false;
      continue;
    }

    const local = evaluateNode(subject, node.rules, at);

    // (4) A matching deny anywhere short-circuits, regardless of allows.
    if (local.kind === 'deny') {
      return {
        allowed: false,
        visibility: 'hidden',
        unlockAt: null,
        reason: { kind: 'rule', ruleId: local.ruleId, clause: local.clause },
        decidedAtNodeId: node.id,
      };
    }

    if (isRoot) {
      current = decisionFromLocal(local, node.id);
      isRoot = false;
      continue;
    }

    // (1) and (5): intersect with the parent. A child may only narrow.
    current = narrow(current, local, node.id);
  }

  return current;
}

/* ------------------------------------------------------------------ */
/* Per-node evaluation                                                 */
/* ------------------------------------------------------------------ */

type LocalOutcome =
  | { kind: 'deny'; ruleId: string; clause: ClauseName }
  | { kind: 'allow'; ruleId: string; clause: ClauseName }
  | {
      kind: 'locked';
      ruleId: string;
      unlockAt: Date;
      visibility: LockedVisibility;
    }
  | { kind: 'no-match' };

function evaluateNode(subject: Subject, rules: AccessRule[], at: Date): LocalOutcome {
  const ordered = [...rules].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  // Denies are evaluated first and short-circuit.
  for (const rule of ordered) {
    if (rule.effect !== 'deny') continue;
    const failed = firstFailingClause(subject, rule.conditions, at);
    if (failed === null) {
      return { kind: 'deny', ruleId: rule.id, clause: decidingClause(rule.conditions) };
    }
  }

  let bestLock: { ruleId: string; unlockAt: Date; visibility: LockedVisibility } | null =
    null;

  for (const rule of ordered) {
    if (rule.effect !== 'allow') continue;
    const failed = firstFailingClause(subject, rule.conditions, at);

    if (failed === null) {
      // A full match anywhere in the node is enough (values ORed across rules).
      return { kind: 'allow', ruleId: rule.id, clause: decidingClause(rule.conditions) };
    }

    // (6) Everything matched except tenure -> locked, not denied.
    if (failed === 'tenure' && rule.conditions.tenure) {
      const unlockAt = unlockInstant(
        subject.anchors,
        rule.conditions.tenure,
        subject.timezone,
      );
      // A rule naming an anchor the subject does not have is a plain non-match,
      // not a lock: there is no date to promise.
      if (unlockAt !== null) {
        const visibility = rule.visibilityWhenLocked ?? 'teaser';
        if (bestLock === null || unlockAt.getTime() < bestLock.unlockAt.getTime()) {
          bestLock = { ruleId: rule.id, unlockAt, visibility };
        }
      }
    }
  }

  if (bestLock) {
    return {
      kind: 'locked',
      ruleId: bestLock.ruleId,
      unlockAt: bestLock.unlockAt,
      visibility: bestLock.visibility,
    };
  }

  return { kind: 'no-match' };
}

function decisionFromLocal(local: LocalOutcome, nodeId: string): Decision {
  switch (local.kind) {
    case 'allow':
      return {
        allowed: true,
        visibility: 'full',
        unlockAt: null,
        reason: { kind: 'rule', ruleId: local.ruleId, clause: local.clause },
        decidedAtNodeId: nodeId,
      };
    case 'locked':
      return {
        allowed: false,
        visibility: local.visibility,
        unlockAt: local.unlockAt,
        reason: { kind: 'rule', ruleId: local.ruleId, clause: 'tenure' },
        decidedAtNodeId: nodeId,
      };
    case 'deny':
      return {
        allowed: false,
        visibility: 'hidden',
        unlockAt: null,
        reason: { kind: 'rule', ruleId: local.ruleId, clause: local.clause },
        decidedAtNodeId: nodeId,
      };
    case 'no-match':
      return {
        allowed: false,
        visibility: 'hidden',
        unlockAt: null,
        reason: { kind: 'no-rule' },
        decidedAtNodeId: nodeId,
      };
  }
}

/**
 * Intersects a child outcome with the parent decision. Access narrows down the
 * tree and never widens: whatever the parent withheld stays withheld.
 */
function narrow(parent: Decision, local: LocalOutcome, nodeId: string): Decision {
  const child = decisionFromLocal(local, nodeId);

  // The parent hid it outright: the child cannot open it.
  if (!parent.allowed && parent.unlockAt === null) return parent;

  // The parent locked it on tenure.
  if (!parent.allowed && parent.unlockAt !== null) {
    // The child hides it entirely -> hidden wins (narrower).
    if (!child.allowed && child.unlockAt === null) return child;
    // Both locked -> the later of the two dates, since both must pass.
    if (!child.allowed && child.unlockAt !== null) {
      return child.unlockAt.getTime() > parent.unlockAt.getTime() ? child : parent;
    }
    // The child allows, the parent locks -> still locked by the parent.
    return parent;
  }

  // The parent allowed. The child decides, and can only narrow.
  return child;
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Returns the name of the first clause that does not match, or null when every
 * clause matches. Tenure is tested LAST so that "everything but tenure" is
 * distinguishable from a plain non-match — that distinction is the product.
 */
export function firstFailingClause(
  subject: Subject,
  c: RuleConditions,
  at: Date,
): ClauseName | null {
  if (!matchesSet(c.departmentIds, subject.departmentId)) return 'department';
  if (!matchesSet(c.roleIds, subject.roleId)) return 'role';
  if (!matchesSet(c.employeeTypeIds, subject.employeeTypeId)) return 'employee_type';
  if (!matchesSet(c.locationIds, subject.locationId)) return 'location';
  if (!matchesAnyOf(c.groupIds, subject.groupIds)) return 'group';
  if (!matchesNumber(c.hoursPerWeek, subject.hoursPerWeek)) return 'hours_per_week';

  if (c.tenure) {
    if (!tenureSatisfied(subject.anchors, c.tenure, subject.timezone, at)) return 'tenure';
  }
  return null;
}

/** The clause a fully-matching rule is best described by, for the explain sentence. */
function decidingClause(c: RuleConditions): ClauseName {
  if (isList(c.employeeTypeIds)) return 'employee_type';
  if (isList(c.departmentIds)) return 'department';
  if (isList(c.roleIds)) return 'role';
  if (isList(c.locationIds)) return 'location';
  if (isList(c.groupIds)) return 'group';
  if (c.hoursPerWeek) return 'hours_per_week';
  if (c.tenure) return 'tenure';
  return 'department';
}

function isList(v: string[] | 'any' | undefined): v is string[] {
  return Array.isArray(v);
}

/** Absent or 'any' always matches. An empty list matches nothing. */
function matchesSet(condition: string[] | 'any' | undefined, value: string | null): boolean {
  if (condition === undefined || condition === 'any') return true;
  if (value === null) return false;
  return condition.includes(value);
}

/** Group membership: the subject matches if it holds any of the listed groups. */
function matchesAnyOf(condition: string[] | 'any' | undefined, values: string[]): boolean {
  if (condition === undefined || condition === 'any') return true;
  return condition.some((c) => values.includes(c));
}

function matchesNumber(condition: NumericCondition | undefined, value: number | null): boolean {
  if (condition === undefined) return true;
  if (value === null) return false;
  switch (condition.op) {
    case 'gte':
      return value >= condition.value;
    case 'lte':
      return value <= condition.value;
    case 'gt':
      return value > condition.value;
    case 'lt':
      return value < condition.value;
    case 'eq':
      return value === condition.value;
  }
}
