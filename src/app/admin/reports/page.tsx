import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { csrfToken } from '@/lib/csrf';
import { db } from '@/db/client';
import { departments, employeeProfiles, employeeTypes, issueReports, locations, pages, roles } from '@/db/schema';
import { CloseReportForm } from '@/components/close-report-form';
import { closeReport } from './actions';

export const dynamic = 'force-dynamic';

const KINDS: Record<string, string> = {
  out_of_date: 'Out of date',
  wrong: 'Wrong',
  missing: 'Something missing',
  unclear: 'Could not follow it',
  broken_link: 'A link goes nowhere',
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireAdmin();
  const { filter = 'open' } = await searchParams;
  const csrf = await csrfToken();

  const rows = await db
    .select({
      id: issueReports.id,
      kind: issueReports.kind,
      body: issueReports.body,
      state: issueReports.state,
      outcome: issueReports.outcome,
      createdAt: issueReports.createdAt,
      pageTitle: pages.title,
      pageSlug: pages.slug,
      who: employeeProfiles.displayName,
      department: departments.name,
      role: roles.name,
      type: employeeTypes.name,
      site: locations.name,
    })
    .from(issueReports)
    .leftJoin(pages, eq(pages.id, issueReports.pageId))
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, issueReports.reporterId))
    .leftJoin(departments, eq(departments.id, employeeProfiles.departmentId))
    .leftJoin(roles, eq(roles.id, employeeProfiles.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, employeeProfiles.employeeTypeId))
    .leftJoin(locations, eq(locations.id, employeeProfiles.locationId))
    .orderBy(desc(issueReports.createdAt));

  const shown = filter === 'all' ? rows : rows.filter((row) => (filter === 'resolved' ? row.state !== 'open' : row.state === 'open'));

  return (
    <>
      <p className="eyebrow">Reports and audit</p>
      <h1 className="page-title">What employees told you</h1>
      <p className="lead">
        Each report arrives with its page reference and the four values that decide what that person can see — so you can
        tell a wrong page from a page that simply never reached them.
      </p>

      <p className="meta">
        <Link href="/admin/reports?filter=open">Open</Link> · <Link href="/admin/reports?filter=resolved">Closed</Link> ·{' '}
        <Link href="/admin/reports?filter=all">Everything</Link> · <Link href="/admin/audit">Audit log</Link>
      </p>

      {shown.length === 0 ? (
        <p className="lead">No open reports.</p>
      ) : (
        <ul className="rows">
          {shown.map((row) => (
            <li className="row" key={row.id}>
              <span className="meta">
                {KINDS[row.kind] ?? row.kind}
                <br />
                {row.createdAt.toLocaleDateString()}
                {row.state !== 'open' ? (
                  <>
                    <br />
                    {row.state}
                  </>
                ) : null}
              </span>
              <span>
                <span className="row-title">
                  {row.pageSlug ? <Link href={`/p/${row.pageSlug}`}>{row.pageTitle}</Link> : 'No page attached'}
                </span>
                <p style={{ margin: '4px 0 0' }}>{row.body}</p>
                <p className="meta" style={{ margin: '4px 0 0' }}>
                  {row.who ?? 'Somebody'} — {[row.department, row.role, row.type, row.site].filter(Boolean).join(' · ') || 'no dimensions set'}
                </p>
                {row.state === 'open' ? (
                  <CloseReportForm csrf={csrf} action={closeReport} id={row.id} />
                ) : (
                  <p className="meta" style={{ margin: '6px 0 0' }}>
                    {row.state === 'resolved' ? 'What changed: ' : 'Why it is not a fault: '}
                    {row.outcome}
                  </p>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
