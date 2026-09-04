import Link from 'next/link';
import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { readTree } from '@/lib/content/read';
import { outstandingAcknowledgments } from '@/lib/content/acknowledge';
import { resolveContactsForNode } from '@/lib/contacts/resolve';
import { formatDate } from '../browse/page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home' };

/**
 * The personalised home.
 *
 * Every number here is a read-time query. Nothing is stored as a count, a
 * percentage or a progress string.
 */
export default async function Home() {
  const { subject, session } = await requireViewer();
  const db = sql();

  const [tree, outstanding] = await Promise.all([
    readTree(db, subject),
    outstandingAcknowledgments(db, subject),
  ]);

  const locked = tree
    .filter((i) => i.locked && i.unlockAt)
    .sort((a, b) => (a.unlockAt! < b.unlockAt! ? -1 : 1));
  const nextUnlock = locked[0];
  const readable = tree.filter((i) => i.level === 'page' && !i.locked);

  if (tree.length === 0 && outstanding.length === 0) {
    const contacts = await resolveContactsForNode(db, null, subject, {
      isAdmin: session.isAdmin,
      isManager: false,
    });
    const hr = contacts[0];
    return (
      <>
        <h1 style={{ fontSize: 29, marginBottom: 10 }}>
          Your company hasn&rsquo;t published anything yet
        </h1>
        <p className="lead" style={{ marginBottom: 22 }}>Here&rsquo;s who to ask.</p>
        {hr ? (
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>{hr.purpose}</p>
            <p style={{ margin: '0 0 2px', fontSize: 17 }}>{hr.name}</p>
            {hr.email ? <a href={`mailto:${hr.email}`}>{hr.email}</a> : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 29, marginBottom: 24 }}>Your handbook</h1>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '26px 30px',
          marginBottom: 38,
        }}
      >
        <Stat
          label="Available to you"
          value={String(readable.length)}
          note="Pages your record lets you read right now."
        />
        <Stat
          label="Waiting on you"
          value={String(outstanding.length)}
          note={
            outstanding.length === 0
              ? 'Nothing needs your acknowledgment.'
              : 'Policies published to you that you have not acknowledged.'
          }
          accent={outstanding.length > 0}
        />
        <Stat
          label="Arriving later"
          value={String(locked.length)}
          note={
            nextUnlock
              ? `Next: ${nextUnlock.title}, ${formatDate(nextUnlock.unlockAt)}.`
              : 'Everything available to you is unlocked.'
          }
        />
      </section>

      {outstanding.length > 0 ? (
        <section style={{ marginBottom: 34 }}>
          <h2 style={{ fontSize: 25, marginBottom: 12 }}>Waiting on you</h2>
          <div className="rows">
            {outstanding.map((o) => (
              <div key={o.version_id}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>
                  <Link href={`/p/${o.slug}`}>{o.title}</Link>
                </p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                  Version {o.version_no} — not yet acknowledged
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {locked.length > 0 ? (
        <section>
          <h2 style={{ fontSize: 25, marginBottom: 6 }}>What arrives when</h2>
          <p className="lead" style={{ marginBottom: 14 }}>
            Locked is not the same as denied. Knowing what is coming is most of the value.
          </p>
          <div className="rows">
            {locked.map((l) => (
              <div key={l.id}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{l.title}</p>
                {l.teaser ? (
                  <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '62ch' }}>
                    {l.teaser}
                  </p>
                ) : null}
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                  Unlocks {formatDate(l.unlockAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 4 }}>{label}</p>
      <p
        style={{
          margin: '0 0 3px',
          fontSize: 27,
          lineHeight: 1.1,
          color: accent ? 'var(--color-accent-2-700)' : 'var(--color-text)',
        }}
      >
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-700)', maxWidth: '32ch' }}>
        {note}
      </p>
    </div>
  );
}
