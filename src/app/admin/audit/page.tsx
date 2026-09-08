import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/db/client';
import { auditEvents, employeeProfiles, users } from '@/db/schema';

export const dynamic = 'force-dynamic';

const AREAS = ['Content', 'Documents', 'People', 'Access', 'Setup', 'Auth'];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  await requireAdmin();
  const { area } = await searchParams;

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      area: auditEvents.area,
      summary: auditEvents.summary,
      at: auditEvents.at,
      actor: employeeProfiles.displayName,
      actorEmail: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, auditEvents.actorUserId))
    .orderBy(desc(auditEvents.at))
    .limit(500);

  const shown = area && AREAS.includes(area) ? rows.filter((row) => row.area === area) : rows;

  return (
    <>
      <p className="eyebrow">Audit</p>
      <h1 className="page-title">Everything that happened</h1>
      <p className="lead">
        Append-only. There is no update path and no delete path — not in the application, and not for the database role
        it runs as.
      </p>

      <p className="meta">
        <Link href="/admin/audit">Everything</Link>
        {AREAS.map((name) => (
          <span key={name}>
            {' · '}
            <Link href={`/admin/audit?area=${name}`}>{name}</Link>
          </span>
        ))}
        {' · '}
        <Link href={`/admin/audit/export${area ? `?area=${area}` : ''}`}>Export as CSV</Link>
      </p>

      <ul className="rows">
        {shown.map((row) => (
          <li className="row" key={row.id}>
            <span className="meta">
              {row.at.toLocaleString()}
              <br />
              {row.area}
            </span>
            <span>
              <span className="row-title">{row.summary}</span>
              <p className="meta" style={{ margin: '2px 0 0' }}>
                {row.actor ?? row.actorEmail ?? 'The system'} · {row.action}
              </p>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
