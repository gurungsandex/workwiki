import type { Sql } from 'postgres';
import { z } from 'zod';
import { audit } from '@/lib/audit/write';
import { conditionsSchema } from './conditions';
import { evaluate } from './evaluate';
import { loadSubject, resolveChain } from './resolve-chain';
import type { RuleConditions } from './types';

/**
 * Writing access rules.
 *
 * The evaluator itself stays pure and database-free; this is the admin-side
 * boundary that stores rules and answers "who does this reach?" — which is a
 * live count, never stored.
 */

export const ruleInput = z.object({
  targetId: z.string().uuid(),
  effect: z.enum(['allow', 'deny']),
  conditions: conditionsSchema,
  visibilityWhenLocked: z.enum(['hidden', 'teaser']).default('teaser'),
});

type Failure = { ok: false; error: string };

export async function createRule(
  sql: Sql,
  input: z.infer<typeof ruleInput>,
  actorUserId: string,
): Promise<{ ok: true; id: string; message: string } | Failure> {
  const node = await sql<{ title: string }[]>`
    SELECT title FROM content_node
     WHERE id = ${input.targetId}::uuid AND archived_at IS NULL`;
  if (!node[0]) return { ok: false, error: 'That section or page does not exist.' };

  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO access_rule
        (target_type, target_id, effect, conditions, visibility_when_locked, created_by)
      VALUES ('node', ${input.targetId}::uuid, ${input.effect},
              ${tx.json(input.conditions as never)}, ${input.visibilityWhenLocked},
              ${actorUserId}::uuid)
      RETURNING id`;
    await audit(tx, {
      actorUserId,
      action: `access.rule.create.${input.effect}`,
      area: 'Access',
      targetType: 'content_node',
      targetId: input.targetId,
      after: { effect: input.effect, conditions: input.conditions },
    });
    return {
      ok: true as const,
      id: rows[0]!.id,
      message:
        input.effect === 'deny'
          ? `Rule saved on ${node[0]!.title}. A deny beats every allow, here and anywhere below.`
          : `Rule saved on ${node[0]!.title}. It applies here and to everything beneath it, narrowed by any rule further down.`,
    };
  });
}

export async function archiveRule(
  sql: Sql,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ target_id: string; effect: string; title: string }[]>`
      SELECT r.target_id, r.effect, n.title
        FROM access_rule r JOIN content_node n ON n.id = r.target_id
       WHERE r.id = ${id}::uuid AND r.archived_at IS NULL FOR UPDATE OF r`;
    if (!rows[0]) return { ok: false as const, error: 'That rule is already gone.' };

    await tx`UPDATE access_rule SET archived_at = now(), updated_at = now()
              WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'access.rule.archive',
      area: 'Access',
      targetType: 'content_node',
      targetId: rows[0]!.target_id,
      before: { effect: rows[0]!.effect },
    });
    return {
      ok: true as const,
      // Says what changed about reach, not that a row was deleted.
      message:
        rows[0]!.effect === 'deny'
          ? `Rule removed from ${rows[0]!.title}. Whoever it was holding back is now decided by the allow rules alone.`
          : `Rule removed from ${rows[0]!.title}. If nothing else allows it, it now reaches nobody.`,
    };
  });
}

export type Reach = {
  visible: number;
  locked: number;
  hidden: number;
  headcount: number;
};

/**
 * How many people a node actually reaches, right now.
 *
 * Runs the real evaluator per person rather than approximating, so the number
 * an admin sees is the number the reading path will produce. Computed on
 * demand; never stored.
 */
export async function reachOf(
  sql: Sql,
  nodeId: string,
  at: Date = new Date(),
): Promise<Reach> {
  const people = await sql<{ user_id: string }[]>`
    SELECT p.user_id FROM employee_profile p
      JOIN app_user u ON u.id = p.user_id
     WHERE p.archived_at IS NULL AND u.archived_at IS NULL AND u.status = 'active'`;

  const chain = await resolveChain(sql, nodeId);
  let visible = 0;
  let locked = 0;
  let hidden = 0;

  for (const person of people) {
    const subject = await loadSubject(sql, person.user_id);
    if (!subject) continue;
    const decision = evaluate(subject, chain, at);
    if (decision.allowed) visible += 1;
    else if (decision.unlockAt !== null && decision.visibility === 'teaser') locked += 1;
    else hidden += 1;
  }

  return { visible, locked, hidden, headcount: people.length };
}

/**
 * The explain endpoint's core (spec §9): why does this person see, or not see,
 * this node — and when does it change?
 */
export async function explainFor(
  sql: Sql,
  nodeId: string,
  userId: string,
  at: Date = new Date(),
) {
  const subject = await loadSubject(sql, userId);
  if (!subject) return null;
  const chain = await resolveChain(sql, nodeId);
  const decision = evaluate(subject, chain, at);

  const ruleRow = decision.reason.kind === 'rule'
    ? await sql<{ conditions: RuleConditions; effect: string }[]>`
        SELECT conditions, effect FROM access_rule WHERE id = ${decision.reason.ruleId}::uuid`
    : [];

  return {
    decision,
    rule: ruleRow[0] ?? null,
    timezone: subject.timezone,
  };
}
