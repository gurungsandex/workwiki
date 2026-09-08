import Link from 'next/link';
import { requireReader } from '@/lib/auth/guards';
import { search } from '@/lib/search';
import { resolveContact } from '@/lib/contacts';
import { consume } from '@/lib/rate-limit';
import { ContactCardView } from '@/components/contact-card';

export const dynamic = 'force-dynamic';

/**
 * A no-result search is never a dead end: it resolves the named person whose
 * job it is to answer, pre-fills a mail with the query, the role and the page,
 * and says plainly that the query is logged for whoever maintains the handbook.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const { subject, viewer } = await requireReader();
  const query = q.trim();

  if (!query) {
    return (
      <>
        <p className="eyebrow">Search</p>
        <h1 className="page-title">Ask it the way you would ask a person</h1>
        <p className="lead">“when do I get insurance”, “how much notice for time off”, “who signs my expenses”.</p>
      </>
    );
  }

  // Search is cheap per query and expensive in aggregate; a runaway client
  // gets a plain sentence rather than a queue of full-text scans.
  const limit = await consume('search:user', subject.userId);
  if (!limit.allowed) {
    return (
      <>
        <p className="eyebrow">Search</p>
        <h1 className="page-title">That is a lot of searching</h1>
        <p className="lead">Give it a minute and try again.</p>
      </>
    );
  }

  const { hits } = await search(query, subject);
  const contact = hits.length === 0 ? await resolveContact({ departmentId: subject.departmentId, viewer }) : null;

  if (hits.length === 0) {
    const subjectLine = encodeURIComponent(`Handbook question: ${query}`);
    const body = encodeURIComponent(
      `I searched the handbook for “${query}” and found nothing.\n\nThis came from the search page.`,
    );
    return (
      <>
        <p className="eyebrow">Search</p>
        <h1 className="page-title">Nobody has written this up yet</h1>
        <p className="lead">
          Nothing in the handbook answers “{query}”. That is a gap, not a mistake on your part — the query is logged for
          whoever maintains this.
        </p>
        {contact ? (
          <>
            <ContactCardView card={contact.card} heading="Ask this person instead" />
            {contact.card.email ? (
              <p>
                <a className="btn btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }} href={`mailto:${contact.card.email}?subject=${subjectLine}&body=${body}`}>
                  Email them the question
                </a>
              </p>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Search</p>
      <h1 className="page-title">“{query}”</h1>
      <p className="lead">
        {hits.length} result{hits.length === 1 ? '' : 's'} from company policy.
      </p>
      <ul className="rows">
        {hits.map((hit) => (
          <li className="row" key={hit.id}>
            <span className="meta">
              {hit.sectionTitle}
              <br />
              {hit.topicTitle}
            </span>
            <span>
              <Link className="row-title" href={`/p/${hit.slug}`}>
                {hit.title}
              </Link>
              <p className="meta" style={{ margin: '2px 0 0' }}>
                {hit.snippet.replaceAll('<<', '').replaceAll('>>', '') || hit.teaser}
              </p>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
