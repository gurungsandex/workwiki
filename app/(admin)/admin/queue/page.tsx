import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports and audit' };

export default async function Queue() {
  const db = sql();
  const [issues, events] = await Promise.all([
    db<
      {
        id: string;
        kind: string;
        body: string;
        status: string;
        outcome: string | null;
        created_at: Date;
        node_title: string | null;
      }[]
    >`
      SELECT i.id, i.kind, i.body, i.status, i.outcome, i.created_at, n.title AS node_title
        FROM issue_report i
        LEFT JOIN content_node n ON n.id = i.node_id
       ORDER BY (i.status = 'open') DESC, i.created_at DESC
       LIMIT 50`,
    db<
      { id: string; action: string; area: string; at: Date; actor_label: string | null }[]
    >`
      SELECT e.id, e.action, e.area, e.at,
             COALESCE(e.actor_label, p.display_name) AS actor_label
        FROM audit_event e
        LEFT JOIN employee_profile p ON p.user_id = e.actor_user_id
       ORDER BY e.at DESC LIMIT 50`,
  ]);

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Reports and audit</p>
      <h1 style={{ fontSize: 34, marginBottom: 30 }}>What employees reported</h1>

      {issues.length === 0 ? (
        <p className="lead" style={{ marginBottom: 44 }}>No open reports.</p>
      ) : (
        <div className="rows" style={{ marginBottom: 44 }}>
          {issues.map((i) => (
            <div key={i.id}>
              <p className="eyebrow" style={{ marginBottom: 3 }}>
                {i.kind}
                {i.node_title ? ` · ${i.node_title}` : ''}
              </p>
              <p style={{ margin: '0 0 3px', fontSize: 16.5, maxWidth: '66ch' }}>{i.body}</p>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color:
                    i.status === 'open'
                      ? 'var(--color-accent-2-700)'
                      : 'var(--color-neutral-600)',
                }}
              >
                {i.status === 'open' ? 'Open' : i.outcome ?? 'Resolved'}
              </p>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 24, marginBottom: 6 }}>Audit log</h2>
      <p className="lead" style={{ marginBottom: 18 }}>
        Append-only. There is no update path and no delete path — the database rejects
        both, not just the application.
      </p>
      <div className="rows">
        {events.map((e) => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 16 }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
              {new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }).format(e.at)}
            </span>
            <div>
              <p style={{ margin: 0, fontSize: 14.5 }}>{e.action}</p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                {e.area}
                {e.actor_label ? ` · ${e.actor_label}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
