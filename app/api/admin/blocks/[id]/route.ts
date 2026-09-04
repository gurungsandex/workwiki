import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { archiveBlock, publishSummary, updateBlock } from '@/lib/content/manage';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const body = (await request.json().catch(() => null)) as
    | { data?: unknown; action?: string }
    | null;

  if (body && body.action === 'publish-summary') {
    const r = await publishSummary(sql(), id, guard.session.userId);
    return r.ok ? json(r) : problem(409, r.error);
  }

  const parsed = z.object({ data: z.unknown() }).safeParse(body);
  if (!parsed.success) return problem(400, 'That was not understood.');

  const result = await updateBlock(sql(), id, parsed.data.data, guard.session.userId);
  return result.ok ? json(result) : problem(400, result.error);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const result = await archiveBlock(sql(), id, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
