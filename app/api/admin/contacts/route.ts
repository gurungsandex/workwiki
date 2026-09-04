import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { bindContact, contactInput, createContact } from '@/lib/contacts/manage';
import { json, problem } from '@/lib/http';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bindInput = z.object({
  bind: z.literal(true),
  cardId: z.string().uuid(),
  targetType: z.enum(['node', 'department', 'location']),
  targetId: z.string().uuid(),
  purpose: z.string().max(80).default('Who to ask'),
});

export async function POST(request: Request) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);

  const binding = bindInput.safeParse(raw);
  if (binding.success) {
    const r = await bindContact(sql(), binding.data, guard.session.userId);
    return r.ok ? json(r) : problem(409, r.error);
  }

  const parsed = contactInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return problem(400, `${first?.path.join('.') || 'That'} — ${first?.message ?? 'is not valid'}.`);
  }

  const result = await createContact(sql(), parsed.data, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}
