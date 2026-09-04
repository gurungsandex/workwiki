import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { acknowledge } from '@/lib/content/acknowledge';
import { clientIp, json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  pageVersionId: z.string().uuid(),
  contentHashHex: z.string().regex(/^[0-9a-f]{64}$/i),
});

export async function POST(request: Request) {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That acknowledgment was not understood.');

  const result = await acknowledge(sql(), guard.viewer.subject, {
    ...parsed.data,
    ip: await clientIp(),
  });

  if (!result.ok) {
    const status = result.code === 'stale' ? 409 : result.code === 'forbidden' ? 403 : 404;
    return problem(status, result.error);
  }
  return json({ ok: true, alreadyAcknowledged: result.alreadyAcknowledged });
}
