import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { explainFor, reachOf } from '@/lib/access/rules-admin';
import { explainSentence, ruleSentence } from '@/lib/access/sentence';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  nodeId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  /** Preview-as time travel: evaluate on a simulated date. */
  at: z.string().datetime().optional(),
});

/**
 * Spec §9: returns the evaluator's reason for a given subject, rendered as the
 * sentence the preview tool shows. Also returns live reach, so an admin sees
 * how many people a rule actually lands on before trusting it.
 */
export async function POST(request: Request) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That request was not understood.');

  const db = sql();
  const at = parsed.data.at ? new Date(parsed.data.at) : new Date();

  const reach = await reachOf(db, parsed.data.nodeId, at);

  if (!parsed.data.userId) return json({ reach });

  const explained = await explainFor(db, parsed.data.nodeId, parsed.data.userId, at);
  if (!explained) return problem(404, 'That person has no employee record to evaluate.');

  const labels = await loadLabels(db);
  const sentence = explained.rule
    ? ruleSentence(explained.rule.conditions, labels, explained.rule.effect as 'allow' | 'deny')
    : null;

  return json({
    reach,
    decision: explained.decision,
    explanation: explainSentence({
      allowed: explained.decision.allowed,
      locked: explained.decision.unlockAt !== null,
      ruleSentence: sentence,
      unlockAt: explained.decision.unlockAt,
      timezone: explained.timezone,
    }),
  });
}

async function loadLabels(db: ReturnType<typeof sql>) {
  const [departments, roles, types, locations, groups] = await Promise.all([
    db<{ id: string; name: string }[]>`SELECT id, name FROM department WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM role WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM employee_type WHERE archived_at IS NULL`,
    db<{ id: string; name: string }[]>`SELECT id, name FROM location WHERE archived_at IS NULL`,
    db<{ slug: string; name: string }[]>`SELECT slug, name FROM employee_group WHERE archived_at IS NULL`,
  ]);
  const map = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  const look = (m: Map<string, string>) => (id: string) => m.get(id) ?? 'something removed';
  return {
    department: look(map(departments)),
    role: look(map(roles)),
    employeeType: look(map(types)),
    location: look(map(locations)),
    group: look(new Map(groups.map((g) => [g.slug, g.name]))),
  };
}
