import Link from 'next/link';

/**
 * Block renderers.
 *
 * Rendered on the server, from a snapshot the access engine already released.
 * A block whose kind has no renderer is skipped silently rather than dumped as
 * JSON: an employee never sees the platform's internals.
 */

export type RenderedBlock = {
  id: string;
  kind: string;
  slot: string | null;
  data: unknown;
};

export function Blocks({ blocks }: { blocks: RenderedBlock[] }) {
  return (
    <>
      {blocks.map((b) => (
        <Block key={b.id} block={b} />
      ))}
    </>
  );
}

function Block({ block }: { block: RenderedBlock }) {
  const d = block.data as Record<string, unknown>;

  switch (block.kind) {
    case 'summary':
      return (
        <section style={{ marginBottom: 30 }}>
          <p className="eyebrow" style={{ marginBottom: 6 }}>
            In short
          </p>
          <p style={{ fontSize: 17, lineHeight: 1.5, maxWidth: '62ch', margin: 0 }}>
            {String(d.text ?? '')}
          </p>
          {/* Persistent and inline, not a footer: this is a summary, and the
              linked source governs. */}
          <p className="note" style={{ marginTop: 10, fontStyle: 'italic' }}>
            {String(
              d.label ??
                'A plain-language summary written by your company. Where it differs from the attached document, the document governs.',
            )}
          </p>
        </section>
      );

    case 'key_points': {
      const points = (d.points as string[] | undefined) ?? [];
      return (
        <section style={{ marginBottom: 30 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            What matters
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.2em', maxWidth: '62ch' }}>
            {points.map((p, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {p}
              </li>
            ))}
          </ul>
        </section>
      );
    }

    case 'callout':
      return (
        <aside
          style={{
            margin: '0 0 30px',
            paddingLeft: 16,
            borderLeft: `3px solid ${
              d.tone === 'attention' ? 'var(--color-accent-2)' : 'var(--color-accent)'
            }`,
            maxWidth: '62ch',
          }}
        >
          <p style={{ margin: 0 }}>{String(d.text ?? '')}</p>
        </aside>
      );

    case 'rich_text':
      return (
        <section style={{ marginBottom: 30, maxWidth: '62ch' }}>
          <RichText node={d.doc} />
        </section>
      );

    case 'guide': {
      const steps = (d.steps as GuideStep[] | undefined) ?? [];
      return (
        <section style={{ marginBottom: 30 }}>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Step by step
          </p>
          <ol className="rows" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14 }}>
                <span
                  style={{
                    fontSize: 17,
                    color: s.external ? 'var(--color-accent-2-700)' : 'var(--color-accent-700)',
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <p style={{ margin: '0 0 3px', fontSize: 16.5 }}>{s.title}</p>
                  {s.detail ? (
                    <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '62ch' }}>
                      {s.detail}
                    </p>
                  ) : null}
                  {/* Internal versus external is a visual language, not a word:
                      the destination domain is shown so one glance answers
                      "does clicking this leave the company?" */}
                  {s.external ? (
                    <p style={{ margin: 0, fontSize: 12.5 }}>
                      <a href={s.external.url} rel="noopener noreferrer nofollow external" target="_blank">
                        {s.external.domain} ↗
                      </a>
                      {s.external.lastVerifiedAt ? (
                        <span style={{ color: 'var(--color-neutral-600)' }}>
                          {' '}· last checked {s.external.lastVerifiedAt}
                        </span>
                      ) : null}
                    </p>
                  ) : s.owner ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                      {s.owner} · inside the company
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {d.personalChecklist !== false ? (
            <p className="note" style={{ marginTop: 12 }}>
              Ticking these off is for your own tracking — it notifies no one and
              submits nothing.
            </p>
          ) : null}
        </section>
      );
    }

    case 'external_link':
      return (
        <p style={{ marginBottom: 18, fontSize: 14 }}>
          <a href={String(d.url)} rel="noopener noreferrer nofollow external" target="_blank">
            {String(d.title)} ↗
          </a>{' '}
          <span style={{ color: 'var(--color-neutral-600)', fontSize: 12.5 }}>
            {String(d.domain)}
          </span>
        </p>
      );

    case 'document':
      return (
        <p style={{ marginBottom: 18, fontSize: 14 }}>
          <Link href={`/api/files/${String(d.fileObjectId)}`}>
            {String(d.caption ?? 'Open the original document')}
          </Link>
        </p>
      );

    case 'image':
      return (
        <figure style={{ margin: '0 0 26px' }}>
          {/* Proxied through the access-checked route; never a public URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${String(d.fileObjectId)}`} alt={String(d.alt)} />
          {d.caption ? (
            <figcaption style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
              {String(d.caption)}
            </figcaption>
          ) : null}
        </figure>
      );

    case 'table': {
      const headers = (d.headers as string[] | undefined) ?? [];
      const rows = (d.rows as string[][] | undefined) ?? [];
      return (
        <div style={{ overflowX: 'auto', marginBottom: 30 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13.5, width: '100%' }}>
            {d.caption ? <caption className="eyebrow">{String(d.caption)}</caption> : null}
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: 'left',
                      padding: '8px 12px 8px 0',
                      borderBottom: '1px solid var(--color-neutral-300)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      style={{
                        padding: '10px 12px 10px 0',
                        borderTop: '1px solid var(--color-neutral-300)',
                        verticalAlign: 'top',
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      return null;
  }
}

type GuideStep = {
  title: string;
  detail?: string;
  owner?: string;
  external?: { url: string; domain: string; lastVerifiedAt?: string };
};

/** Renders the constrained TipTap document. Unknown node types are dropped. */
function RichText({ node }: { node: unknown }): React.ReactNode {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; text?: string; content?: unknown[] };
  const children = Array.isArray(n.content)
    ? n.content.map((c, i) => <RichText key={i} node={c} />)
    : null;

  switch (n.type) {
    case 'doc':
      return <>{children}</>;
    case 'paragraph':
      return <p style={{ margin: '0 0 12px' }}>{children}</p>;
    case 'heading':
      return <h3 style={{ fontSize: 19, margin: '20px 0 8px' }}>{children}</h3>;
    case 'bulletList':
      return <ul style={{ margin: '0 0 12px', paddingLeft: '1.2em' }}>{children}</ul>;
    case 'orderedList':
      return <ol style={{ margin: '0 0 12px', paddingLeft: '1.2em' }}>{children}</ol>;
    case 'listItem':
      return <li>{children}</li>;
    case 'blockquote':
      return (
        <blockquote
          style={{
            margin: '0 0 12px',
            paddingLeft: 16,
            borderLeft: '3px solid var(--color-neutral-300)',
          }}
        >
          {children}
        </blockquote>
      );
    case 'hardBreak':
      return <br />;
    case 'text':
      return <>{n.text ?? ''}</>;
    default:
      return children ? <>{children}</> : null;
  }
}
