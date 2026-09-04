import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { archiveRule } from '@/lib/access/rules-admin';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const result = await archiveRule(sql(), id, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
