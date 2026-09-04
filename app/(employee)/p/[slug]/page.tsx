import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { readPage } from '@/lib/content/read';
import { resolveContactsForNode } from '@/lib/contacts/resolve';
import { Blocks } from '@/components/content/Blocks';
import { AcknowledgeButton } from './AcknowledgeButton';
import { formatDate } from '../../browse/page';

export const dynamic = 'force-dynamic';

/**
 * One content page, in the fixed five-beat order: summary, key points,
 * guidance, who to ask, source.
 *
 * The decision is made before render. A locked page renders its teaser here;
 * its body was never fetched.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { subject, session } = await requireViewer();
  const { slug } = await params;
  const db = sql();

  const page = await readPage(db, subject, slug);
  if (page.kind === 'not-found') notFound();

  if (page.kind === 'locked') {
    return (
      <article>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Not yet</p>
        <h1 style={{ fontSize: 29, marginBottom: 10 }}>{page.title}</h1>
        {page.teaser ? <p className="lead" style={{ marginBottom: 14 }}>{page.teaser}</p> : null}
        <p style={{ fontSize: 15, color: 'var(--color-accent-2-700)', margin: 0 }}>
          Unlocks {formatDate(page.unlockAt)}.
        </p>
        <p className="note" style={{ marginTop: 16 }}>
          This page exists and applies to you from that date. Nothing is hidden from
          you as a judgement — it simply has not started yet.
        </p>
      </article>
    );
  }

  const contacts = await resolveContactsForNode(db, page.id, subject, {
    isAdmin: session.isAdmin,
    isManager: false,
  });

  const acknowledged = await db<{ id: string }[]>`
    SELECT id FROM acknowledgment
     WHERE user_id = ${subject.userId}::uuid AND page_version_id = ${page.versionId}::uuid`;

  return (
    <article>
      <h1 style={{ fontSize: 29, marginBottom: 20 }}>{page.title}</h1>

      <Blocks blocks={page.blocks} />

      {contacts.length > 0 ? (
        <section style={{ marginBottom: 30 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>Who to ask</p>
          <div className="rows">
            {contacts.map((c) => (
              <div key={c.id}>
                <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{c.name}</p>
                {c.title ? (
                  <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)' }}>
                    {c.title}
                  </p>
                ) : null}
                {c.email ? (
                  <p style={{ margin: 0, fontSize: 12.5 }}>
                    <a href={`mailto:${c.email}`}>{c.email}</a>
                  </p>
                ) : null}
                {c.responseTimeNote ? (
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                    {c.responseTimeNote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="no-print" style={{ marginTop: 34 }}>
        <AcknowledgeButton
          pageVersionId={page.versionId}
          contentHashHex={page.contentHashHex}
          alreadyAcknowledged={acknowledged.length > 0}
        />
        <p className="note" style={{ marginTop: 10 }}>
          Version {page.versionNo}. An acknowledgment names the exact version you read.
        </p>
      </section>
    </article>
  );
}
