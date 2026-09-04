'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type Row = {
  id: string;
  name: string;
  note: string;
  archived: boolean;
};

export type Kind = 'department' | 'role' | 'employee_type' | 'location';

/**
 * One dimension list: add, rename, remove, restore.
 *
 * List rows with a 1px separator — never cards. No transitions. Every action
 * writes a human sentence into the save-state line, in the prototype's voice.
 */
export function DimensionList({
  kind,
  title,
  lead,
  empty,
  rows,
  addLabel,
  extraField,
}: {
  kind: Kind;
  title: string;
  lead: string;
  empty: string;
  rows: Row[];
  addLabel: string;
  extraField?: { name: 'departmentId' | 'timezone' | 'typeKind'; label: string; options: { value: string; label: string }[] };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const [extra, setExtra] = useState(extraField?.options[0]?.value ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const live = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);

  async function send(url: string, init: RequestInit) {
    setError(null);
    setSaved(null);
    const response = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      name?: string;
    };
    if (!response.ok) {
      setError(data.error ?? 'That did not go through.');
      return false;
    }
    setSaved(data.message ?? null);
    startTransition(() => router.refresh());
    return true;
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 24, marginBottom: 6 }}>{title}</h2>
      <p className="lead" style={{ marginBottom: 18 }}>{lead}</p>

      {live.length === 0 ? (
        <p className="lead" style={{ marginBottom: 18 }}>{empty}</p>
      ) : (
        <div className="rows" style={{ marginBottom: 18 }}>
          {live.map((row) => (
            <div
              key={row.id}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'baseline' }}
            >
              <div>
                {renaming === row.id ? (
                  <form
                    style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const ok = await send(`/api/admin/dimensions/${kind}/${row.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ name: renameDraft }),
                      });
                      if (ok) setRenaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      style={{
                        font: 'inherit',
                        fontSize: 16.5,
                        padding: '4px 8px',
                        border: '1px solid var(--color-neutral-400)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)',
                      }}
                    />
                    <button className="inline-action" type="submit">Save</button>
                    <button
                      className="inline-action"
                      type="button"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>{row.name}</p>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-700)', maxWidth: '66ch' }}>
                      {row.note}
                    </p>
                  </>
                )}
              </div>
              {renaming === row.id ? null : (
                <div style={{ display: 'flex', gap: 14, whiteSpace: 'nowrap' }}>
                  <button
                    className="inline-action"
                    type="button"
                    onClick={() => {
                      setRenaming(row.id);
                      setRenameDraft(row.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="inline-action inline-action-destructive"
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      send(`/api/admin/dimensions/${kind}/${row.id}`, { method: 'DELETE' })
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const payload: Record<string, string> = { name: draft };
          if (extraField && extra) payload[extraField.name] = extra;
          const ok = await send(`/api/admin/dimensions/${kind}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          if (ok) setDraft('');
        }}
      >
        <label className="field">
          <span className="eyebrow">{addLabel}</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
            maxLength={120}
            style={{ minWidth: 240 }}
          />
        </label>

        {extraField ? (
          <label className="field">
            <span className="eyebrow">{extraField.label}</span>
            <select value={extra} onChange={(e) => setExtra(e.target.value)}>
              {extraField.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        <button className="btn" type="submit" disabled={pending || !draft.trim()}>
          Add
        </button>
      </form>

      {error ? (
        <p role="alert" style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-accent-2-700)', maxWidth: '66ch' }}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-accent-700)', maxWidth: '66ch' }}>
          {saved}
        </p>
      ) : null}

      {archived.length > 0 ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', cursor: 'pointer' }}>
            Removed ({archived.length})
          </summary>
          <div className="rows" style={{ marginTop: 8 }}>
            {archived.map((row) => (
              <div
                key={row.id}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'baseline' }}
              >
                <p style={{ margin: 0, fontSize: 15, color: 'var(--color-neutral-700)' }}>{row.name}</p>
                <button
                  className="inline-action"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    send(`/api/admin/dimensions/${kind}/${row.id}/restore`, { method: 'POST' })
                  }
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
