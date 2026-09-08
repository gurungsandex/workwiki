import Link from 'next/link';

/**
 * One renderer per block kind. Progressive disclosure is a fixed page order:
 * summary, key points, guidance, who to ask, source — the same five beats on
 * every long document, so the shape becomes learnable.
 */

export interface RenderedBlock {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  bylineKind: string | null;
  publishedAt: Date | null;
}

function domainOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

function RichText({ node }: { node: unknown }): React.ReactNode {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type: string; text?: string; content?: unknown[]; attrs?: { level?: number }; marks?: { type: string; attrs?: { href?: string } }[] };
  const children = (n.content ?? []).map((child, i) => <RichText key={i} node={child} />);

  switch (n.type) {
    case 'doc':
      return <>{children}</>;
    case 'paragraph':
      return <p>{children}</p>;
    case 'heading':
      return n.attrs?.level === 2 ? <h2 className="sub-heading">{children}</h2> : <h3 className="sub-heading">{children}</h3>;
    case 'bulletList':
      return <ul>{children}</ul>;
    case 'orderedList':
      return <ol>{children}</ol>;
    case 'listItem':
      return <li>{children}</li>;
    case 'blockquote':
      return <blockquote>{children}</blockquote>;
    case 'hardBreak':
      return <br />;
    case 'text': {
      let out: React.ReactNode = n.text ?? '';
      for (const mark of n.marks ?? []) {
        if (mark.type === 'bold') out = <strong>{out}</strong>;
        else if (mark.type === 'italic') out = <em>{out}</em>;
        else if (mark.type === 'link' && mark.attrs?.href) {
          out = (
            <a className="external-mark" href={mark.attrs.href} rel="noopener noreferrer nofollow" target="_blank">
              {out}
            </a>
          );
        }
      }
      return out;
    }
    default:
      return null;
  }
}

export function BlockView({ block, byline }: { block: RenderedBlock; byline?: string | null }) {
  const data = block.data;

  switch (block.kind) {
    case 'summary':
      return (
        <section>
          <h2 className="section-heading">In short</h2>
          <p className="body-copy">{String(data.text ?? '')}</p>
          {/* The summary label is persistent and inline, never a footer. */}
          <p className="meta">
            {String(data.label ?? 'This is a plain-language summary. The linked source governs.')}
            {byline ? ` ${byline}` : ''}
          </p>
        </section>
      );

    case 'key_points':
      return (
        <section>
          <h2 className="section-heading">What it means for you</h2>
          <ul className="body-copy">
            {((data.points ?? []) as string[]).map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      );

    case 'rich_text':
      return <div className="body-copy">{<RichText node={data.doc} />}</div>;

    case 'callout':
      return (
        <p className={`notice${data.tone === 'attention' ? ' notice-attention' : ''}`}>{String(data.text ?? '')}</p>
      );

    case 'steps': {
      const steps = (data.steps ?? []) as { text: string; external?: boolean }[];
      const handoff = data.handoff as { kind: string; label: string; href?: string } | null;
      return (
        <section>
          <h2 className="section-heading">Steps, in order</h2>
          <ol className="body-copy">
            {steps.map((step, i) => (
              <li key={i} className={step.external ? 'external-mark' : undefined}>
                {step.text}
              </li>
            ))}
          </ol>
          {handoff ? (
            <p className="meta">
              {handoff.kind === 'external' && handoff.href ? (
                <>
                  Last step leaves the company:{' '}
                  <a className="external-mark" href={handoff.href} rel="noopener noreferrer nofollow" target="_blank">
                    {handoff.label}
                  </a>{' '}
                  ({domainOf(handoff.href)})
                </>
              ) : (
                <>Hand this to: {handoff.label}</>
              )}
            </p>
          ) : null}
          <p className="meta">Ticking a step is for your own tracking — this notifies no one and submits nothing.</p>
        </section>
      );
    }

    case 'table': {
      const header = (data.header ?? []) as string[];
      const rows = (data.rows ?? []) as string[][];
      return (
        <section style={{ overflowX: 'auto' }}>
          {data.caption ? <h3 className="sub-heading">{String(data.caption)}</h3> : null}
          <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '8px 18px 8px 0', borderBottom: '1px solid var(--color-neutral-300)' }}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding: '8px 18px 8px 0', borderTop: '1px solid var(--color-neutral-300)' }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    }

    case 'external_link': {
      const href = String(data.href ?? '');
      return (
        <p className="meta">
          <a className="external-mark" href={href} rel="noopener noreferrer nofollow" target="_blank">
            {String(data.title ?? href)}
          </a>{' '}
          — {domainOf(href)}
          {data.lastVerifiedAt ? ` · last checked ${new Date(String(data.lastVerifiedAt)).toLocaleDateString()}` : ''}
        </p>
      );
    }

    case 'document':
      return (
        <p className="meta">
          <Link href={`/files/${String(data.fileId)}`}>The document itself</Link>
          {data.caption ? ` — ${String(data.caption)}` : ''}
        </p>
      );

    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/files/${String(data.fileId)}`} alt={String(data.alt ?? '')} style={{ maxWidth: '100%' }} />
      );

    case 'review':
      return data.reviewDueAt ? (
        <p className="meta">Next reviewed {new Date(String(data.reviewDueAt)).toLocaleDateString()}.</p>
      ) : null;

    default:
      return null;
  }
}
