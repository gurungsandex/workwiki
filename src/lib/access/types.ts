import type { CalendarDate, Offset } from './dates';

export type { CalendarDate, Offset };

/** Everything the evaluator is allowed to know about a person. */
export interface Subject {
  userId: string;
  departmentId: string | null;
  roleId: string | null;
  employeeTypeId: string | null;
  locationId: string | null;
  /** Anchor slug -> calendar date. `hire_date` is mirrored here like any other. */
  anchors: Record<string, CalendarDate>;
  groupIds: string[];
  hoursPerWeek: number | null;
  /** IANA zone of the person's location; the instance default when unset. */
  timeZone: string;
}

export type NumericOperator = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';

/**
 * A rule's conditions. Conditions are ANDed; values inside a condition are ORed.
 * A condition that is absent, or the string 'any', always matches — the admin
 * never sees this shape, the condition builder writes it.
 */
export interface Conditions {
  department?: string[] | 'any';
  role?: string[] | 'any';
  employeeType?: string[] | 'any';
  location?: string[] | 'any';
  group?: string[] | 'any';
  hoursPerWeek?: { op: NumericOperator; value: number };
  tenure?: Offset;
}

export type Effect = 'allow' | 'deny';
export type LockedVisibility = 'hidden' | 'teaser' | 'preview';
export type Visibility = 'full' | LockedVisibility;

export interface AccessRule {
  id: string;
  effect: Effect;
  conditions: Conditions;
  /** What reaches the client when everything but tenure matched. */
  visibilityWhenLocked: LockedVisibility;
  priority: number;
}

/** One level of the resolved ancestor chain, root first. */
export interface Node {
  id: string;
  type: 'section' | 'topic' | 'page' | 'benefit' | 'external_resource';
  rules: AccessRule[];
}

export type Reason =
  | { kind: 'rule'; ruleId: string; clause: ClauseName }
  | { kind: 'inherited'; from: string }
  | { kind: 'no-rule' };

export type ClauseName =
  | 'department'
  | 'role'
  | 'employeeType'
  | 'location'
  | 'group'
  | 'hoursPerWeek'
  | 'tenure'
  | 'match';

export interface Decision {
  allowed: boolean;
  visibility: Visibility;
  /** Set only when the decision is a tenure lock. */
  unlockAt: Date | null;
  reason: Reason;
  /** The node whose rules produced this decision, for the explain tool. */
  decidedAt: string | null;
}
