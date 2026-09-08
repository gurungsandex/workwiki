import Link from 'next/link';
import { requireReader } from '@/lib/auth/guards';
import { buildOrgView, loadOrgChart, matchesOrgQuery } from '@/lib/org';

export const dynamic = 'force-dynamic';

/** Opens centred on the reader. Everyone can see everyone. */
export default async function OrgPage({ searchParams }: { searchParams: Promise<{ focus?: string; q?: string }> }) {
  const { focus: focusParam, q = '' } = await searchParams;
  const { subject } = await requireReader();
  const nodes = await loadOrgChart();

  if (nodes.length === 0) {
    return (
      <>
        <p className="eyebrow">Org chart</p>
        <h1 className="page-title">The org chart hasn’t been built yet</h1>
        <p className="lead">When reporting lines are imported or drawn, the whole company appears here.</p>
      </>
    );
  }

  const own = nodes.find((node) => node.userId === subject.userId) ?? null;
  const focusId = focusParam ?? own?.id ?? nodes[0]?.id ?? null;
  const view = buildOrgView(nodes, focusId);
  const matches = q ? nodes.filter((node) => matchesOrgQuery(node, q)) : null;

  return (
    <>
      <p className="eyebrow">Org chart</p>
      <h1 className="page-title">The whole company</h1>

      <form action="/org" method="get" className="no-print">
        <label className="field">
          <span>Find someone</span>
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Name, title, department or site" />
        </label>
      </form>

      {matches ? (
        <section>
          <h2 className="section-heading">Matches</h2>
          {matches.length === 0 ? (
            <p className="lead">Nobody by that name, title, department or site.</p>
          ) : (
            <ul className="rows">
              {matches.map((node) => (
                <li className="row-single" key={node.id}>
                  <Link className="row-title" href={`/org?focus=${node.id}`}>
                    {node.name ?? node.title ?? 'Unfilled position'}
                  </Link>
                  <p className="meta" style={{ margin: 0 }}>
                    {[node.title, node.department, node.location].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {view.chain.length > 0 ? (
        <p className="meta">
          {view.chain.map((node, i) => (
            <span key={node.id}>
              {i > 0 ? ' › ' : ''}
              <Link href={`/org?focus=${node.id}`}>{node.name ?? node.title ?? 'Unfilled position'}</Link>
            </span>
          ))}
        </p>
      ) : null}

      {view.focus ? (
        <section>
          <h2 className="section-heading" style={view.focus.isOpenRole ? { color: 'var(--color-accent-2-700)' } : undefined}>
            {view.focus.name ?? 'Unfilled position'}
          </h2>
          <p className="lead">
            {[view.focus.title, view.focus.department, view.focus.location, view.focus.employeeType]
              .filter(Boolean)
              .join(' · ')}
            {view.focus.onLeave ? ' · on leave' : ''}
          </p>
          {view.focus.email ? (
            <p className="meta">
              <a href={`mailto:${view.focus.email}`}>{view.focus.email}</a>
              {view.focus.phone ? ` · ${view.focus.phone}` : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="section-heading">Reports to them</h2>
        {view.reports.length === 0 ? (
          <p className="lead">Nobody reports to them.</p>
        ) : (
          <ul className="rows">
            {view.reports.map((node) => (
              <li className="row-single" key={node.id}>
                <Link className="row-title" href={`/org?focus=${node.id}`} style={node.isOpenRole ? { color: 'var(--color-accent-2-700)' } : undefined}>
                  {node.name ?? node.title ?? 'Unfilled position'}
                </Link>
                <p className="meta" style={{ margin: 0 }}>{[node.title, node.location].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-heading">Alongside them</h2>
        {view.peers.length === 0 ? (
          <p className="lead">Nobody else reports to the same person.</p>
        ) : (
          <ul className="rows">
            {view.peers.map((node) => (
              <li className="row-single" key={node.id}>
                <Link className="row-title" href={`/org?focus=${node.id}`} style={node.isOpenRole ? { color: 'var(--color-accent-2-700)' } : undefined}>
                  {node.name ?? node.title ?? 'Unfilled position'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-heading">The whole company</h2>
        <ul className="rows">
          {view.outline.map(({ node, depth }) => (
            <li className="row-single" key={node.id} style={{ paddingLeft: depth * 18 }}>
              <Link
                href={`/org?focus=${node.id}`}
                style={{
                  color: node.id === view.focus?.id ? 'var(--color-accent-700)' : node.isOpenRole ? 'var(--color-accent-2-700)' : undefined,
                }}
              >
                {node.name ?? node.title ?? 'Unfilled position'}
              </Link>
              {node.title && node.name ? <span className="meta"> — {node.title}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <p className="meta">
        {own ? <Link href={`/org?focus=${own.id}`}>Back to me</Link> : null}
        {own ? ' · ' : ''}
        <Link href="/org">Top of the company</Link>
      </p>
      <p className="meta">
        Reporting lines come from the people import where a manager name matched, and from an admin drawing them
        otherwise. If a line is wrong, <Link href="/report">report it</Link>.
      </p>
    </>
  );
}
