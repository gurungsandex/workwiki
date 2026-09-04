import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { createRule, ruleInput } from '@/lib/access/rules-admin';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = ruleInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return problem(400, `${first?.path.join('.') || 'That rule'} — ${first?.message ?? 'is not valid'}.`);
  }

  const result = await createRule(sql(), parsed.data, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
