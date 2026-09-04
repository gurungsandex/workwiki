import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { createNode, createNodeInput } from '@/lib/content/manage';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const parsed = createNodeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return problem(400, `${first?.path.join('.') || 'That'} — ${first?.message ?? 'is not valid'}.`);
  }

  const result = await createNode(sql(), parsed.data, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
