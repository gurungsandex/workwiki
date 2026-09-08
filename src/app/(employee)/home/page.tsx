import Link from 'next/link';
import { requireReader } from '@/lib/auth/guards';
import { loadNavigation } from '@/lib/content/read';
import { outstandingFor } from '@/lib/acknowledgments';
import { resolveContact } from '@/lib/contacts';
import { companyName, instanceSettings } from '@/lib/instance';
import { ContactCardView } from '@/components/contact-card';

export const dynamic = 'force-dynamic';

/**
 * The personalised home. Everything on it is computed at read time from the
 * evaluator's decisions — there is no progress column, and no status string is
 * stored anywhere.
 */
export default async function HomePage() {
  const { subject, viewer } = await requireReader();
  const now = new Date();

  const [nav, outstanding, settings] = await Promise.all([
    loadNavigation(subject, now),
    outstandingFor(subject, now),
    instanceSettings(),
  ]);

  const pages = nav.flatMap((section) => section.topics.flatMap((topic) => topic.pages));
  const readable = pages.filter((page) => page.decision.allowed);
  const locked = pages
    .filter((page) => !page.decision.allowed && page.decision.unlockAt)
    .sort((a, b) => a.decision.unlockAt!.getTime() - b.decision.unlockAt!.getTime());

  const fallback = await resolveContact({ departmentId: subject.departmentId, viewer });

  if (readable.length === 0 && locked.length === 0) {
    return (
      <>
        <p className="eyebrow">Home</p>
        <h1 className="page-title">Nothing published yet</h1>
        <p className="lead">
          {companyName(settings)} hasn’t published anything to the handbook yet. Here’s who to ask in the meantime.
        </p>
        {fallback ? <ContactCardView card={fallback.card} /> : null}
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Home</p>
      <h1 className="page-title">What applies to you</h1>
      <p className="lead">
        {readable.length} page{readable.length === 1 ? '' : 's'} you can read
        {locked.length > 0 ? `, ${locked.length} still to come` : ''}.
      </p>

      {outstanding.length > 0 ? (
        <section>
          <h2 className="section-heading">Waiting on you</h2>
          <ul className="rows">
            {outstanding.map((item) => (
              <li className="row" key={item.versionId}>
                <span className="meta">Needs acknowledging</span>
                <span>
                  <Link className="row-title" href={`/p/${item.slug}`}>
                    {item.title}
                  </Link>
                  <br />
                  <span className="meta">
                    Version {item.versionNo}, published {item.publishedAt.toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {locked.length > 0 ? (
        <section>
          <h2 className="section-heading">Next to unlock</h2>
          <ul className="rows">
            {locked.slice(0, 5).map((page) => (
              <li className="row" key={page.id}>
                <span className="meta">{page.decision.unlockAt!.toLocaleDateString()}</span>
                <span>
                  <span className="row-title locked">{page.title}</span>
                  {page.teaser ? (
                    <>
                      <br />
                      <span className="meta">{page.teaser}</span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="section-heading">Where to start</h2>
        <ul className="rows">
          {readable.slice(0, 8).map((page) => (
            <li className="row-single" key={page.id}>
              <Link className="row-title" href={`/p/${page.slug}`}>
                {page.title}
              </Link>
              {page.teaser ? <p className="meta" style={{ margin: '2px 0 0' }}>{page.teaser}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
