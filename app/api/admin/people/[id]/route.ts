import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { createInvite, setPersonStatus } from '@/lib/people/manage';
import { env } from '@/lib/env';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const actionInput = z.object({
  action: z.enum(['invite', 'deactivate', 'reactivate']),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const parsed = actionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That action was not understood.');

  const db = sql();
  const actor = guard.session.userId;

  if (parsed.data.action === 'invite') {
    const r = await createInvite(db, id, actor);
    if (!r.ok) return problem(409, r.error);
    // The link is returned once, here. It is stored only as a hash.
    return json({
      ok: true,
      message: r.message,
      link: `${env().BASE_URL}/join?token=${encodeURIComponent(r.token)}`,
      expiresAt: r.expiresAt,
    });
  }

  const r = await setPersonStatus(
    db,
    id,
    parsed.data.action === 'deactivate' ? 'deactivated' : 'active',
    actor,
  );
  return r.ok ? json(r) : problem(409, r.error);
}
