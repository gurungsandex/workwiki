import type { PublicContactCard } from '@/lib/serialize';

/**
 * Any unfilled surface is hidden, never shown as an empty card — so a field the
 * reader may not see, or that nobody filled in, is simply absent.
 */
export function ContactCardView({ card, heading }: { card: PublicContactCard; heading?: string }) {
  return (
    <section>
      {heading ? <h2 className="section-heading">{heading}</h2> : null}
      <div className="row-single">
        <p className="row-title" style={{ margin: 0 }}>
          {card.personName ?? card.label}
        </p>
        {card.roleTitle ? <p className="meta" style={{ margin: '2px 0 0' }}>{card.roleTitle}</p> : null}
        {card.email ? (
          <p className="meta" style={{ margin: '2px 0 0' }}>
            <a href={`mailto:${card.email}`}>{card.email}</a>
          </p>
        ) : null}
        {card.phone ? <p className="meta" style={{ margin: '2px 0 0' }}>{card.phone}</p> : null}
        {card.responseTime ? (
          <p className="meta" style={{ margin: '2px 0 0' }}>Usually answers {card.responseTime}.</p>
        ) : null}
        {card.note ? <p className="meta" style={{ margin: '2px 0 0' }}>{card.note}</p> : null}
        {card.orgNodeId ? (
          <p className="meta" style={{ margin: '4px 0 0' }}>
            <a href={`/org?focus=${card.orgNodeId}`}>Find them in the org chart</a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
