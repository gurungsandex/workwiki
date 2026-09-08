import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { setupState } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * The checklist is derived from what exists in the instance, never from a
 * stored step number — so it survives sessions and tells the truth.
 */
export default async function AdminDashboard() {
  await requireAdmin();
  const state = await setupState();
  const done = state.checklist.filter((item) => item.done).length;

  return (
    <>
      <p className="eyebrow">Setup</p>
      <h1 className="page-title">What is left to do</h1>
      <p className="lead">
        {state.complete
          ? 'Everything checks out. This list stays here and keeps reflecting real state.'
          : `${done} of ${state.checklist.length} done. Nothing here is a wizard step — each line is checked against what actually exists.`}
      </p>

      <ul className="rows">
        {state.checklist.map((item) => (
          <li className="row" key={item.key}>
            <span className="meta">{item.done ? 'Done' : <span className="attention">Outstanding</span>}</span>
            <span>
              <Link className="row-title" href={item.href}>
                {item.label}
              </Link>
              <p className="meta" style={{ margin: '2px 0 0' }}>{item.hint}</p>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="section-heading">Diagnostics</h2>
      <p className="lead">
        <Link href="/readyz">Database, storage and migrations</Link> — the same check the container uses to decide it is
        ready. <Link href="/admin/setup">Company details, timezone, accent and the mail test</Link> live on the setup
        page.
      </p>
    </>
  );
}
