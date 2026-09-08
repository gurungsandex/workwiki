import { requireAdmin } from '@/lib/auth/guards';
import { contentHealth, failedSearches } from '@/lib/health';

export const dynamic = 'force-dynamic';

export default async function GapsPage() {
  await requireAdmin();
  const [checks, searches] = await Promise.all([contentHealth(), failedSearches()]);
  const now = new Date();

  return (
    <>
      <p className="eyebrow">Gaps and health</p>
      <h1 className="page-title">What is missing</h1>

      <h2 className="section-heading">Searches that found nothing</h2>
      <p className="lead">
        The highest-signal list in the product: what your employees went looking for and did not find. Each one is a
        section somebody needs.
      </p>
      {searches.length === 0 ? (
        <p className="lead">Not enough activity yet — this fills in once employees start searching.</p>
      ) : (
        <ul className="rows">
          {searches.map((search) => (
            <li className="row" key={search.query}>
              <span className="meta">
                {search.times} time{search.times === 1 ? '' : 's'}
              </span>
              <span>
                <span className="row-title">{search.query}</span>
                <p className="meta" style={{ margin: '2px 0 0' }}>
                  {search.who} · last asked {search.lastAt.toLocaleDateString()}
                </p>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-heading">Content health</h2>
      {checks.every((check) => check.count === 0) ? (
        <p className="lead">Everything checks out, as at {now.toLocaleString()}.</p>
      ) : (
        <ul className="rows">
          {checks
            .filter((check) => check.count > 0)
            .map((check) => (
              <li className="row" key={check.key}>
                <span className="meta attention">{check.count}</span>
                <span>
                  <span className="row-title">{check.label}</span>
                  <p className="meta" style={{ margin: '2px 0 0' }}>{check.detail}</p>
                </span>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}
