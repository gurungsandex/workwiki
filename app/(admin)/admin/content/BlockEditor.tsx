'use client';

import { useState } from 'react';

/**
 * Per-kind block forms.
 *
 * Only the rich-text kind is a document editor; every other block is a typed
 * form, which is what keeps content queryable instead of a blob of HTML.
 */

export type BlockRow = {
  id: string;
  kind: string;
  slot: string | null;
  data: Record<string, unknown>;
  publishedAt: string | null;
  bylineKind: string | null;
  sourceUrl: string | null;
};

export const BLOCK_CHOICES: { kind: string; label: string; hint: string }[] = [
  { kind: 'summary', label: 'Summary in your own words', hint: 'The two or three sentences people actually read. Draft until you publish it.' },
  { kind: 'key_points', label: 'What matters', hint: 'Written against the reader, not the organisation.' },
  { kind: 'rich_text', label: 'Guidance', hint: 'Longer prose. Headings, lists, links.' },
  { kind: 'guide', label: 'Steps, in order', hint: 'A guide must end in a named person, a system or an external destination.' },
  { kind: 'callout', label: 'Callout', hint: 'One thing worth pulling out of the flow.' },
  { kind: 'external_link', label: 'Link out', hint: 'Shows the destination domain, so one glance answers "does this leave the company?"' },
  { kind: 'table', label: 'Table', hint: 'Limits, rates, accruals.' },
];

export function blankData(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'summary': return { text: '' };
    case 'key_points': return { points: [''] };
    case 'rich_text': return { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] } };
    case 'guide': return { steps: [{ title: '', detail: '', owner: '' }], personalChecklist: true };
    case 'callout': return { tone: 'note', text: '' };
    case 'external_link': return { url: '', title: '', domain: '' };
    case 'table': return { headers: ['', ''], rows: [['', '']] };
    default: return {};
  }
}

const box: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  padding: '8px 10px',
  border: '1px solid var(--color-neutral-400)',
  background: 'var(--color-bg)',
  borderRadius: 'var(--radius-md)',
  width: '100%',
};

export function BlockFields({
  kind,
  data,
  onChange,
}: {
  kind: string;
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch });

  switch (kind) {
    case 'summary':
      return (
        <label className="field">
          <span className="eyebrow">Summary</span>
          <textarea
            rows={3}
            style={box}
            maxLength={5000}
            value={String(data.text ?? '')}
            onChange={(e) => set({ text: e.target.value })}
          />
          <span className="helper">
            Two or three sentences, with the number or the date in the first line. A
            generated summary is never published for you.
          </span>
        </label>
      );

    case 'callout':
      return (
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span className="eyebrow">Tone</span>
            <select
              style={box}
              value={String(data.tone ?? 'note')}
              onChange={(e) => set({ tone: e.target.value })}
            >
              <option value="note">Note</option>
              <option value="attention">Attention</option>
            </select>
          </label>
          <label className="field">
            <span className="eyebrow">Text</span>
            <textarea
              rows={2}
              style={box}
              value={String(data.text ?? '')}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
        </div>
      );

    case 'key_points': {
      const points = (data.points as string[] | undefined) ?? [''];
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="eyebrow">What matters</span>
          {points.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input
                style={box}
                value={p}
                onChange={(e) => {
                  const next = [...points];
                  next[i] = e.target.value;
                  set({ points: next });
                }}
              />
              {points.length > 1 ? (
                <button
                  className="inline-action inline-action-destructive"
                  type="button"
                  onClick={() => set({ points: points.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <div>
            <button className="inline-action" type="button" onClick={() => set({ points: [...points, ''] })}>
              Add a point
            </button>
          </div>
        </div>
      );
    }

    case 'rich_text': {
      // The constrained schema is stored as structured JSON; the admin edits
      // plain paragraphs, which is the honest subset until a designed
      // rich-text surface exists.
      const doc = data.doc as { content?: { content?: { text?: string }[] }[] } | undefined;
      const text = (doc?.content ?? [])
        .map((p) => (p.content ?? []).map((t) => t.text ?? '').join(''))
        .join('\n\n');
      return (
        <label className="field">
          <span className="eyebrow">Guidance</span>
          <textarea
            rows={8}
            style={box}
            value={text}
            onChange={(e) =>
              set({
                doc: {
                  type: 'doc',
                  content: e.target.value.split(/\n{2,}/).map((para) => ({
                    type: 'paragraph',
                    content: para ? [{ type: 'text', text: para }] : [],
                  })),
                },
              })
            }
          />
          <span className="helper">A blank line starts a new paragraph.</span>
        </label>
      );
    }

    case 'external_link':
      return (
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span className="eyebrow">Where it goes</span>
            <input
              style={box}
              type="url"
              placeholder="https://www.example.gov/claim"
              value={String(data.url ?? '')}
              onChange={(e) => {
                const url = e.target.value;
                let domain = String(data.domain ?? '');
                try {
                  domain = new URL(url).hostname;
                } catch {
                  /* keep whatever the admin typed until the URL parses */
                }
                set({ url, domain });
              }}
            />
          </label>
          <label className="field">
            <span className="eyebrow">What to call it</span>
            <input style={box} value={String(data.title ?? '')} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <p className="note" style={{ margin: 0 }}>
            Employees see <strong>{String(data.domain || 'the domain')}</strong> next to
            this link, so one glance answers whether clicking it leaves the company.
          </p>
        </div>
      );

    case 'guide': {
      const steps = (data.steps as { title?: string; detail?: string; owner?: string }[] | undefined) ?? [];
      return (
        <div style={{ display: 'grid', gap: 14 }}>
          <span className="eyebrow">Steps, in order</span>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'grid', gap: 6, paddingLeft: 14, borderLeft: '2px solid var(--color-neutral-300)' }}>
              <input
                style={box}
                placeholder={`Step ${i + 1}`}
                value={s.title ?? ''}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...s, title: e.target.value };
                  set({ steps: next });
                }}
              />
              <input
                style={{ ...box, fontSize: 13 }}
                placeholder="What actually happens (optional)"
                value={s.detail ?? ''}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...s, detail: e.target.value };
                  set({ steps: next });
                }}
              />
              <input
                style={{ ...box, fontSize: 13 }}
                placeholder={i === steps.length - 1 ? 'Who or what this hands off to — required on the last step' : 'Who owns this step (optional)'}
                value={s.owner ?? ''}
                onChange={(e) => {
                  const next = [...steps];
                  next[i] = { ...s, owner: e.target.value };
                  set({ steps: next });
                }}
              />
              {steps.length > 1 ? (
                <div>
                  <button
                    className="inline-action inline-action-destructive"
                    type="button"
                    onClick={() => set({ steps: steps.filter((_, j) => j !== i) })}
                  >
                    Remove this step
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <div>
            <button
              className="inline-action"
              type="button"
              onClick={() => set({ steps: [...steps, { title: '', detail: '', owner: '' }] })}
            >
              Add a step
            </button>
          </div>
          <p className="note" style={{ margin: 0 }}>
            The last step must name a person, a system or an external destination. A
            guide that stops in mid-air cannot be published.
          </p>
        </div>
      );
    }

    case 'table': {
      const headers = (data.headers as string[] | undefined) ?? [];
      const rows = (data.rows as string[][] | undefined) ?? [];
      return (
        <div style={{ display: 'grid', gap: 10 }}>
          <span className="eyebrow">Table</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {headers.map((h, i) => (
              <input
                key={i}
                style={{ ...box, fontSize: 13 }}
                placeholder={`Column ${i + 1}`}
                value={h}
                onChange={(e) => {
                  const next = [...headers];
                  next[i] = e.target.value;
                  set({ headers: next });
                }}
              />
            ))}
          </div>
          {rows.map((r, ri) => (
            <div key={ri} style={{ display: 'flex', gap: 6 }}>
              {headers.map((_, ci) => (
                <input
                  key={ci}
                  style={{ ...box, fontSize: 13 }}
                  value={r[ci] ?? ''}
                  onChange={(e) => {
                    const next = rows.map((row) => [...row]);
                    next[ri]![ci] = e.target.value;
                    set({ rows: next });
                  }}
                />
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 14 }}>
            <button
              className="inline-action"
              type="button"
              onClick={() => set({ rows: [...rows, headers.map(() => '')] })}
            >
              Add a row
            </button>
            <button
              className="inline-action"
              type="button"
              onClick={() =>
                set({ headers: [...headers, ''], rows: rows.map((r) => [...r, '']) })
              }
            >
              Add a column
            </button>
          </div>
        </div>
      );
    }

    default:
      return <p className="note">This block kind has no form yet.</p>;
  }
}

/** A one-line description of a block for the collapsed list. */
export function describeBlock(b: BlockRow): string {
  const d = b.data;
  switch (b.kind) {
    case 'summary': return String(d.text ?? '') || 'Empty';
    case 'key_points': return ((d.points as string[]) ?? []).filter(Boolean).join(' · ') || 'Empty';
    case 'callout': return String(d.text ?? '') || 'Empty';
    case 'external_link': return `${d.title ?? ''} — ${d.domain ?? ''}`;
    case 'guide': return `${((d.steps as unknown[]) ?? []).length} steps`;
    case 'table': return `${((d.rows as unknown[]) ?? []).length} rows`;
    case 'rich_text': {
      const doc = d.doc as { content?: { content?: { text?: string }[] }[] } | undefined;
      const first = (doc?.content ?? [])[0]?.content?.[0]?.text ?? '';
      return first || 'Empty';
    }
    default: return b.kind;
  }
}

export function useBlockDraft(initial: Record<string, unknown>) {
  return useState<Record<string, unknown>>(initial);
}
