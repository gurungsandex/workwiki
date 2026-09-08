import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditEvents, employeeProfiles, users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

function cell(value: unknown): string {
  const text = String(value ?? '');
  // Neutralise spreadsheet formula injection on export.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  await requireAdmin();
  const area = new URL(request.url).searchParams.get('area');

  const rows = await db
    .select({
      at: auditEvents.at,
      area: auditEvents.area,
      action: auditEvents.action,
      summary: auditEvents.summary,
      actor: employeeProfiles.displayName,
      actorEmail: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, auditEvents.actorUserId))
    .orderBy(desc(auditEvents.at))
    .limit(20_000);

  const filtered = area ? rows.filter((row) => row.area === area) : rows;
  const csv = [
    ['at', 'area', 'action', 'summary', 'actor'].join(','),
    ...filtered.map((row) =>
      [cell(row.at.toISOString()), cell(row.area), cell(row.action), cell(row.summary), cell(row.actor ?? row.actorEmail)].join(','),
    ),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
