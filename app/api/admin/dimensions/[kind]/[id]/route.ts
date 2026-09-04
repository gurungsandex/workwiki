import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { archiveDimension, renameDimension } from '@/lib/dimensions/manage';
import { json, problem } from '@/lib/http';
import { parseKind } from '../route';

export const dynamic = 'force-dynamic';

const patchBody = z.object({ name: z.string().min(1).max(120) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const { kind: rawKind, id } = await context.params;
  const kind = parseKind(rawKind);
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const parsed = patchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That was not understood.');

  const result = await renameDimension(sql(), kind, id, parsed.data.name, guard.session.userId);
  if (!result.ok) return problem(409, result.error);

  // Rules store ids, so a rename cannot change who sees what.
  return json({ ok: true, message: `${result.from} renamed to ${result.to} — rules followed.` });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const { kind: rawKind, id } = await context.params;
  const kind = parseKind(rawKind);
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const result = await archiveDimension(sql(), kind, id, guard.session.userId);
  // 409, not 400: the request was well-formed, the instance's state refused it.
  if (!result.ok) return problem(409, result.error);
  return json({ ok: true, message: result.message });
}
