'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { accessRules, sections, topics, pages } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { appendAudit } from '@/lib/audit';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { evaluate } from '@/lib/access/engine';
import { chainFor, loadRuleIndex } from '@/lib/content/read';
import { loadAllSubjects, loadSubject } from '@/lib/subject';
import { loadVocabulary } from '@/lib/access/vocabulary';
import { explainDecision, ruleSentence } from '@/lib/access/sentence';
import type { Conditions, Effect, LockedVisibility, Offset } from '@/lib/access/types';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function ids(form: FormData, name: string): string[] {
  return form.getAll(name).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * The builder writes the conditions; the admin sees a sentence. This is the
 * only place a rule is composed, so the JSON shape has exactly one author.
 */
function readConditions(form: FormData): Conditions {
  const conditions: Conditions = {};
  const department = ids(form, 'department');
  const role = ids(form, 'role');
  const employeeType = ids(form, 'employeeType');
  const location = ids(form, 'location');
  if (department.length) conditions.department = department;
  if (role.length) conditions.role = role;
  if (employeeType.length) conditions.employeeType = employeeType;
  if (location.length) conditions.location = location;

  const hours = field(form, 'hoursValue');
  if (hours) {
    const op = (field(form, 'hoursOp') || 'gte') as 'gte' | 'gt' | 'lte' | 'lt' | 'eq';
    conditions.hoursPerWeek = { op, value: Number(hours) };
  }

  const tenureValue = field(form, 'tenureValue');
  if (tenureValue && Number(tenureValue) !== 0) {
    const offset: Offset = {
      anchor: field(form, 'tenureAnchor') || 'hire_date',
      unit: (field(form, 'tenureUnit') || 'day') as Offset['unit'],
      value: Number(tenureValue),
    };
    if (field(form, 'tenureThen') === 'first_of_next_month') offset.then = 'first_of_next_month';
    conditions.tenure = offset;
  }

  return conditions;
}

export async function saveRule(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const targetType = field(form, 'targetType');
  const targetId = field(form, 'targetId');
  if (!['section', 'topic', 'page'].includes(targetType) || !targetId) {
    return { error: 'Pick what this rule is about first.' };
  }

  const effect = (field(form, 'effect') === 'deny' ? 'deny' : 'allow') as Effect;
  const visibilityWhenLocked = (['hidden', 'teaser', 'preview'].includes(field(form, 'visibilityWhenLocked'))
    ? field(form, 'visibilityWhenLocked')
    : 'teaser') as LockedVisibility;

  const conditions = readConditions(form);
  if (conditions.hoursPerWeek && !Number.isFinite(conditions.hoursPerWeek.value)) {
    return { error: 'Hours a week has to be a number.' };
  }
  if (conditions.tenure && !Number.isFinite(conditions.tenure.value)) {
    return { error: 'The tenure figure has to be a number.' };
  }

  await db.insert(accessRules).values({
    targetType,
    targetId,
    effect,
    conditions: conditions as Record<string, unknown>,
    visibilityWhenLocked,
    createdBy: admin.id,
  });

  const vocabulary = await loadVocabulary();
  const sentence = ruleSentence(effect, conditions, vocabulary);

  await appendAudit({
    actorUserId: admin.id,
    action: 'access-rule.create',
    area: 'Access',
    targetType,
    targetId,
    summary: `Rule added: ${sentence}`,
    after: { effect, conditions },
  });

  revalidatePath('/admin/access');
  return { notice: `Rule saved. It reads: ${sentence}` };
}

export async function removeRule(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const id = field(form, 'id');
  const [row] = await db
    .update(accessRules)
    .set({ archivedAt: new Date() })
    .where(and(eq(accessRules.id, id), isNull(accessRules.archivedAt)))
    .returning({ targetType: accessRules.targetType, targetId: accessRules.targetId, effect: accessRules.effect });
  if (!row) return { error: 'That rule has already been removed.' };

  const message =
    row.effect === 'deny'
      ? 'Deny removed — whatever the allows say now decides, and this reaches wider than it did.'
      : 'Allow removed — this now inherits whatever sits above it, which may be wider or narrower.';

  await appendAudit({
    actorUserId: admin.id,
    action: 'access-rule.archive',
    area: 'Access',
    targetType: row.targetType,
    targetId: row.targetId,
    summary: message,
  });

  revalidatePath('/admin/access');
  return { notice: message };
}

/**
 * Explain: the evaluator's reason for one subject, rendered as a sentence.
 * This is what powers preview-as. It is read-only and cannot mutate anything.
 */
export async function explainForPerson(_state: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }

  const userId = field(form, 'userId');
  const pageId = field(form, 'pageId');
  const atRaw = field(form, 'at');
  if (!userId || !pageId) return { error: 'Pick a person and a page.' };

  const at = atRaw ? new Date(`${atRaw}T12:00:00Z`) : new Date();
  if (Number.isNaN(at.getTime())) return { error: 'That is not a date this system can read.' };

  const subject = await loadSubject(userId);
  if (!subject) return { error: 'That person has no employee record yet, so no rule can route to them.' };

  const [row] = await db
    .select({ pageId: pages.id, title: pages.title, topicId: topics.id, sectionId: sections.id })
    .from(pages)
    .innerJoin(topics, eq(topics.id, pages.topicId))
    .innerJoin(sections, eq(sections.id, topics.sectionId))
    .where(eq(pages.id, pageId))
    .limit(1);
  if (!row) return { error: 'That page no longer exists.' };

  const index = await loadRuleIndex();
  const decision = evaluate(subject, chainFor(index, row), at);

  const vocabulary = await loadVocabulary();
  let sentence: string | null = null;
  if (decision.reason.kind === 'rule') {
    const [rule] = await db
      .select({ effect: accessRules.effect, conditions: accessRules.conditions })
      .from(accessRules)
      .where(eq(accessRules.id, decision.reason.ruleId))
      .limit(1);
    if (rule) sentence = ruleSentence(rule.effect as Effect, rule.conditions as Conditions, vocabulary);
  }

  return {
    notice: explainDecision({
      allowed: decision.allowed,
      visibility: decision.visibility,
      unlockAt: decision.unlockAt,
      ruleSentence: sentence,
      clause: decision.reason.kind === 'rule' ? decision.reason.clause : null,
      inherited: decision.reason.kind === 'inherited',
    }),
  };
}

/** How many current employees a rule set matches — shown live beside the builder. */
export async function matchCount(targetType: string, targetId: string, at: Date = new Date()): Promise<{ matched: number; total: number }> {
  const [people, index] = await Promise.all([loadAllSubjects(), loadRuleIndex()]);

  const [row] =
    targetType === 'page'
      ? await db
          .select({ pageId: pages.id, topicId: topics.id, sectionId: sections.id })
          .from(pages)
          .innerJoin(topics, eq(topics.id, pages.topicId))
          .innerJoin(sections, eq(sections.id, topics.sectionId))
          .where(eq(pages.id, targetId))
          .limit(1)
      : [];

  let matched = 0;
  for (const subject of people) {
    const chain = row
      ? chainFor(index, row)
      : [{ id: targetId, type: targetType as 'section' | 'topic', rules: index.get(`${targetType}:${targetId}`) ?? [] }];
    if (evaluate(subject, chain, at).allowed) matched++;
  }

  return { matched, total: people.length };
}
