import Link from 'next/link';
import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { readTree, type TreeItem } from '@/lib/content/read';
import { search } from '@/lib/search/query';
import { logSearch } from '@/lib/search/query';
import { resolveContactsForNode } from '@/lib/contacts/resolve';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Browse' };

export default async function Browse({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { subject, session } = await requireViewer();
  const { q } = await searchParams;
  const db = sql();

  if (q && q.trim().length >= 2) {
    const hits = await search(db, subject, q);
    await logSearch(db, session.userId, q, hits.length);

    if (hits.length === 0) {
      const contacts = await resolveContactsForNode(db, null, subject, {
        isAdmin: session.isAdmin,
        isManager: false,
      });
      const who = contacts[0];
      const mailto = who?.email
        ? `mailto:${who.email}?subject=${encodeURIComponent(`Question about "${q}"`)}&body=${encodeURIComponent(
            `I searched the handbook for "${q}" and did not find an answer.\n\nSent from the handbook.`,
          )}`
        : null;

      return (
        <>
          <h1 style={{ fontSize: 29, marginBottom: 10 }}>Nobody has written this up yet</h1>
          <p className="lead" style={{ marginBottom: 22 }}>
            Nothing in the handbook answers “{q}”. Rather than a dead end: the person
            whose job it is to answer this, for your department and your site. Your
            question is also logged for whoever maintains this handbook, so the next
            person searching it finds a page.
          </p>
          {who ? (
            <div>
              <p className="eyebrow" style={{ marginBottom: 4 }}>
                {who.purpose}
              </p>
              <p style={{ margin: '0 0 2px', fontSize: 17 }}>{who.name}</p>
              {who.title ? (
                <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--color-neutral-700)' }}>
                  {who.title}
                </p>
              ) : null}
              {mailto ? <a href={mailto}>Email them this question</a> : null}
            </div>
          ) : null}
        </>
      );
    }

    return (
      <>
        <h1 style={{ fontSize: 29, marginBottom: 6 }}>
          {hits.length} {hits.length === 1 ? 'result' : 'results'}
        </h1>
        <p className="lead" style={{ marginBottom: 20 }}>for “{q}”</p>
        <div className="rows">
          {hits.map((h) => (
            <div key={h.nodeId}>
              {h.locked ? (
                <>
                  <p style={{ margin: '0 0 2px', fontSize: 17 }}>{h.title}</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                    Unlocks {formatDate(h.unlockAt)}
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: '0 0 2px', fontSize: 17 }}>
                    <Link href={`/p/${h.slug}`}>{h.title}</Link>
                  </p>
                  {h.snippet ? (
                    <p
                      style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '62ch' }}
                      // ts_headline emits <b> around matches; the body it wraps
                      // is content this reader is already entitled to.
                      dangerouslySetInnerHTML={{ __html: sanitiseHeadline(h.snippet) }}
                    />
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  const tree = await readTree(db, subject);
  if (tree.length === 0) {
    return (
      <>
        <h1 style={{ fontSize: 29, marginBottom: 10 }}>Nothing published yet</h1>
        <p className="lead">
          Your company has not published anything to you yet. When it does, it appears
          here.
        </p>
      </>
    );
  }

  const sections = tree.filter((i) => i.level === 'section');
  return (
    <>
      <h1 style={{ fontSize: 29, marginBottom: 22 }}>Browse</h1>
      {sections.map((s) => (
        <SectionBlock key={s.id} section={s} tree={tree} />
      ))}
    </>
  );
}

function SectionBlock({ section, tree }: { section: TreeItem; tree: TreeItem[] }) {
  const topics = tree.filter((i) => i.parentId === section.id);
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontSize: 25, marginBottom: 10 }}>{section.title}</h2>
      {topics.map((t) => {
        const pages = tree.filter((i) => i.parentId === t.id);
        return (
          <div key={t.id} style={{ marginBottom: 18 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              {t.title}
            </p>
            <div className="rows">
              {pages.map((p) => (
                <div key={p.id}>
                  {p.locked ? (
                    <>
                      <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{p.title}</p>
                      {p.teaser ? (
                        <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '62ch' }}>
                          {p.teaser}
                        </p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                        Unlocks {formatDate(p.unlockAt)}
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 16.5 }}>
                      <Link href={`/p/${p.slug}`}>{p.title}</Link>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'a date not yet set';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** ts_headline only ever emits <b>; everything else is escaped. */
function sanitiseHeadline(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>');
}
