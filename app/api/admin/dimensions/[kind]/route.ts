import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { createDimension, type DimensionKind } from '@/lib/dimensions/manage';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const KINDS = ['department', 'role', 'employee_type', 'location'] as const;

const body = z.object({
  name: z.string().min(1).max(120),
  departmentId: z.string().uuid().nullable().optional(),
  // IANA zone; validated against the runtime below rather than a hardcoded list.
  timezone: z.string().min(1).max(64).optional(),
  typeKind: z.enum(['salaried', 'hourly', 'contingent', 'other']).optional(),
});

export function parseKind(raw: string): DimensionKind | null {
  return (KINDS as readonly string[]).includes(raw) ? (raw as DimensionKind) : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;

  const { kind: rawKind } = await context.params;
  const kind = parseKind(rawKind);
  if (!kind) return problem(404, 'Not found.');

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That was not understood.');

  if (parsed.data.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone });
    } catch {
      return problem(400, `"${parsed.data.timezone}" is not a timezone this server knows.`);
    }
  }

  const result = await createDimension(sql(), kind, parsed.data, guard.session.userId);
  if (!result.ok) return problem(409, result.error);
  return json({ ok: true, id: result.id, name: result.name });
}
