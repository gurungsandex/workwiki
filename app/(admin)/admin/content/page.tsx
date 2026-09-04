import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sections' };

export default async function Content() {
  const nodes = await sql()<
    {
      id: string;
      level: string;
      title: string;
      state: string;
      depth: number;
      blocks: string;
      versions: string;
    }[]
  >`
    SELECT n.id, n.level, n.title, n.state, n.depth,
           (SELECT count(*) FROM block b
             WHERE b.node_id = n.id AND b.archived_at IS NULL)::text AS blocks,
           (SELECT count(*) FROM page_version v WHERE v.node_id = n.id)::text AS versions
      FROM content_node n
     WHERE n.archived_at IS NULL
     ORDER BY n.depth, n.sort_key, n.title`;

  return (
    <>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Sections</p>
      <h1 style={{ fontSize: 34, marginBottom: 10 }}>The structure</h1>
      <p className="lead" style={{ marginBottom: 30 }}>
        Section, then topic, then page — three levels, capped by the database rather
        than by a warning. Nothing here reaches an employee until it is published and a
        rule lets them see it.
      </p>

      {nodes.length === 0 ? (
        <p className="lead">
          Nothing here yet. Start by adding a section, then a topic inside it, then a
          page inside that.
        </p>
      ) : (
        <div className="rows">
          {nodes.map((n) => (
            <div
              key={n.id}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16 }}
            >
              <div style={{ paddingLeft: (n.depth - 1) * 22 }}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{n.title}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                  {n.level} · {n.blocks} blocks · {n.versions} published versions
                </p>
              </div>
              <span
                style={{
                  fontSize: 12.5,
                  color:
                    n.state === 'published'
                      ? 'var(--color-accent-700)'
                      : 'var(--color-accent-2-700)',
                }}
              >
                {n.state === 'published' ? 'Published' : 'Draft — nobody sees it'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
