import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { restoreDimension } from '@/lib/dimensions/manage';
import { json, problem } from '@/lib/http';
import { parseKind } from '../../route';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const { kind: rawKind, id } = await context.params;
  const kind = parseKind(rawKind);
  if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const result = await restoreDimension(sql(), kind, id, guard.session.userId);
  if (!result.ok) return problem(409, result.error);
  return json({ ok: true, message: `${result.name} restored — it is back in the lists.` });
}
