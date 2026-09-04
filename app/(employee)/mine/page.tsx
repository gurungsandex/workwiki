import Link from 'next/link';
import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { readTree } from '@/lib/content/read';
import { formatDate } from '../browse/page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My things' };

/** Own attestation history and personal chronology. All computed at read time. */
export default async function Mine() {
  const { subject } = await requireViewer();
  const db = sql();

  const [acknowledged, tree] = await Promise.all([
    db<{ title: string; slug: string; version_no: number; acknowledged_at: Date }[]>`
      SELECT n.title, n.slug, v.version_no, a.acknowledged_at
        FROM acknowledgment a
        JOIN page_version v ON v.id = a.page_version_id
        JOIN content_node n ON n.id = v.node_id
       WHERE a.user_id = ${subject.userId}::uuid
       ORDER BY a.acknowledged_at DESC`,
    readTree(db, subject),
  ]);

  const upcoming = tree
    .filter((i) => i.locked && i.unlockAt)
    .sort((a, b) => (a.unlockAt! < b.unlockAt! ? -1 : 1));

  return (
    <>
      <h1 style={{ fontSize: 29, marginBottom: 26 }}>My things</h1>

      <section style={{ marginBottom: 38 }}>
        <h2 style={{ fontSize: 25, marginBottom: 12 }}>What arrives when</h2>
        {upcoming.length === 0 ? (
          <p className="lead">Everything available to you is unlocked.</p>
        ) : (
          <div className="rows">
            {upcoming.map((u) => (
              <div key={u.id}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{u.title}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                  {formatDate(u.unlockAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 25, marginBottom: 12 }}>What you have acknowledged</h2>
        {acknowledged.length === 0 ? (
          <p className="lead">Nothing needs your acknowledgment.</p>
        ) : (
          <div className="rows">
            {acknowledged.map((a, i) => (
              <div key={i}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>
                  <Link href={`/p/${a.slug}`}>{a.title}</Link>
                </p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                  Version {a.version_no}, acknowledged{' '}
                  {formatDate(a.acknowledged_at.toISOString())}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
