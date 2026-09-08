import Link from 'next/link';
import { requireReader } from '@/lib/auth/guards';
import { loadNavigation } from '@/lib/content/read';

export const dynamic = 'force-dynamic';

export default async function BrowsePage() {
  const { subject } = await requireReader();
  const nav = await loadNavigation(subject);

  if (nav.length === 0) {
    return (
      <>
        <p className="eyebrow">Browse</p>
        <h1 className="page-title">Nothing published yet</h1>
        <p className="lead">
          A section with no published pages is hidden here rather than shown empty. When something is published that
          applies to you, it appears.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Browse</p>
      <h1 className="page-title">Everything that applies to you</h1>
      <p className="lead">Search is usually faster. This is what is here in full.</p>

      {nav.map((section) => (
        <section key={section.id}>
          <h2 className="section-heading">{section.title}</h2>
          {section.lead ? <p className="lead">{section.lead}</p> : null}
          {section.topics.map((topic) => (
            <div key={topic.id}>
              <h3 className="sub-heading">{topic.title}</h3>
              <ul className="rows" style={{ marginTop: 8 }}>
                {topic.pages.map((page) =>
                  page.decision.allowed ? (
                    <li className="row-single" key={page.id}>
                      <Link className="row-title" href={`/p/${page.slug}`}>
                        {page.title}
                      </Link>
                      {page.teaser ? <p className="meta" style={{ margin: '2px 0 0' }}>{page.teaser}</p> : null}
                    </li>
                  ) : (
                    // Locked renders in place: title, unlock date, one line.
                    // Knowing what is coming is core value.
                    <li className="row-single locked" key={page.id}>
                      <span className="row-title">{page.title}</span>
                      <p className="meta" style={{ margin: '2px 0 0' }}>
                        Unlocks {page.decision.unlockAt?.toLocaleDateString()}
                        {page.teaser ? ` — ${page.teaser}` : ''}
                      </p>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
