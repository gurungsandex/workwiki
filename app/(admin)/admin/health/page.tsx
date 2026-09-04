import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gaps and health' };

/**
 * Every figure here is a query. Nothing is a stored count, coverage percentage
 * or status string.
 */
export default async function Health() {
  const db = sql();

  const [failedSearches, checks] = await Promise.all([
    db<{ query: string; n: string; last_at: Date }[]>`
      SELECT query, count(*)::text AS n, max(at) AS last_at
        FROM search_event
       WHERE result_count = 0 AND at > now() - interval '90 days'
       GROUP BY query
       ORDER BY count(*) DESC, max(at) DESC
       LIMIT 20`,
    db<
      {
        no_rule: string;
        unpublished: string;
        no_contact: string;
        stale_summary: string;
        open_issues: string;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM content_node n
          WHERE n.archived_at IS NULL AND n.state = 'published'
            AND NOT EXISTS (
              WITH RECURSIVE up AS (
                SELECT id, parent_id FROM content_node WHERE id = n.id
                UNION ALL
                SELECT p.id, p.parent_id FROM content_node p JOIN up ON p.id = up.parent_id
              )
              SELECT 1 FROM access_rule r
               WHERE r.target_type = 'node' AND r.archived_at IS NULL
                 AND r.target_id IN (SELECT id FROM up)))::text AS no_rule,
        (SELECT count(*) FROM content_node
          WHERE archived_at IS NULL AND state = 'draft')::text AS unpublished,
        (SELECT count(*) FROM content_node n
          WHERE n.archived_at IS NULL AND n.state = 'published' AND n.level = 'page'
            AND n.help_contact_card_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM contact_binding b
                             WHERE b.target_type = 'node' AND b.target_id = n.id
                               AND b.archived_at IS NULL))::text AS no_contact,
        (SELECT count(*) FROM block s
          JOIN block src ON src.id = s.source_block_id
          WHERE s.kind = 'summary' AND s.archived_at IS NULL
            AND s.published_at IS NOT NULL
            AND src.updated_at > s.updated_at)::text AS stale_summary,
        (SELECT count(*) FROM issue_report WHERE status = 'open')::text AS open_issues`,
  ]);

  const c = checks[0]!;
  const rows = [
    {
      count: c.no_rule,
      title: 'Published pages with no rule anywhere in their ancestry',
      note: 'Nothing is public by default, so these reach nobody at all. That is safe, but it is probably not what you meant.',
    },
    {
      count: c.no_contact,
      title: 'Published pages with nobody to ask',
      note: 'An employee who reads this and still has a question has nowhere to go.',
    },
    {
      count: c.stale_summary,
      title: 'Published summaries whose source changed after they were written',
      note: 'The summary may now describe a document that no longer says that. Computed by comparing timestamps, not stored as a flag.',
    },
    {
      count: c.unpublished,
      title: 'Drafts nobody can see',
      note: 'Draft until published is deliberate. This is a reminder, not a fault.',
    },
    {
      count: c.open_issues,
      title: 'Open reports from employees',
      note: 'Resolving one requires saying what changed, and those words go back to the reporter.',
    },
  ];

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Gaps and health</p>
      <h1 style={{ fontSize: 34, marginBottom: 30 }}>Searches that found nothing</h1>
      <p className="lead" style={{ marginBottom: 20 }}>
        The highest-signal list in the product: what your employees went looking for and
        did not find. Each one is a page somebody needs.
      </p>

      {failedSearches.length === 0 ? (
        <p className="lead" style={{ marginBottom: 44 }}>
          Not enough activity yet — this fills in once employees start searching.
        </p>
      ) : (
        <div className="rows" style={{ marginBottom: 44 }}>
          {failedSearches.map((s) => (
            <div
              key={s.query}
              style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 16 }}
            >
              <p style={{ margin: 0, fontSize: 16.5 }}>{s.query}</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-600)' }}>
                {s.n} {Number(s.n) === 1 ? 'time' : 'times'}
              </p>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 24, marginBottom: 18 }}>Content health</h2>
      <div className="rows">
        {rows.map((r) => (
          <div key={r.title} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 16 }}>
            <p
              style={{
                margin: 0,
                fontSize: 21,
                color: Number(r.count) > 0 ? 'var(--color-accent-2-700)' : 'var(--color-neutral-500)',
              }}
            >
              {r.count}
            </p>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{r.title}</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '66ch' }}>
                {r.note}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
