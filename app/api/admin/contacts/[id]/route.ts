import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { archiveContact, contactInput, updateContact } from '@/lib/contacts/manage';
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

  const parsed = contactInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return problem(400, `${first?.path.join('.') || 'That'} — ${first?.message ?? 'is not valid'}.`);
  }

  const result = await updateContact(sql(), id, parsed.data, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const result = await archiveContact(sql(), id, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
