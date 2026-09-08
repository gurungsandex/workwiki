import Link from 'next/link';
import { requireReader } from '@/lib/auth/guards';
import { historyFor, outstandingFor } from '@/lib/acknowledgments';

export const dynamic = 'force-dynamic';

export default async function AcknowledgmentsPage() {
  const { subject } = await requireReader();
  const [outstanding, history] = await Promise.all([outstandingFor(subject), historyFor(subject.userId)]);

  return (
    <>
      <p className="eyebrow">My things</p>
      <h1 className="page-title">Acknowledgments</h1>

      <section>
        <h2 className="section-heading">Waiting on you</h2>
        {outstanding.length === 0 ? (
          <p className="lead">Nothing needs your acknowledgment.</p>
        ) : (
          <ul className="rows">
            {outstanding.map((item) => (
              <li className="row" key={item.versionId}>
                <span className="meta">Version {item.versionNo}</span>
                <Link className="row-title" href={`/p/${item.slug}`}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-heading">Already signed</h2>
        {history.length === 0 ? (
          <p className="lead">You haven’t acknowledged anything yet.</p>
        ) : (
          <ul className="rows">
            {history.map((item, i) => (
              <li className="row" key={`${item.slug}-${i}`}>
                <span className="meta">{item.acknowledgedAt.toLocaleDateString()}</span>
                <span>
                  <Link className="row-title" href={`/p/${item.slug}`}>
                    {item.pageTitle}
                  </Link>
                  <br />
                  <span className="meta">
                    Version {item.versionNo}
                    {item.supersededByVersionNo
                      ? ` — since replaced by version ${item.supersededByVersionNo}, which is waiting on you`
                      : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
