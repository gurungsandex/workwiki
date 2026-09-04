import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  nodeId: z.string().uuid().nullable().optional(),
  kind: z.enum([
    'Something is missing',
    'Something is wrong',
    'I cannot read it',
    'A link is broken',
  ]),
  body: z.string().min(1).max(4000),
});

/**
 * An employee report. The page reference and the reporter's own dimension
 * values are attached automatically — the reporter never types them.
 */
export async function POST(request: Request) {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That report was not understood.');

  const rows = await sql()<{ id: string }[]>`
    INSERT INTO issue_report (reporter_id, node_id, kind, body)
    VALUES (${guard.viewer.subject.userId}::uuid,
            ${parsed.data.nodeId ?? null}::uuid,
            ${parsed.data.kind}, ${parsed.data.body})
    RETURNING id`;

  return json({ ok: true, id: rows[0]!.id });
}
