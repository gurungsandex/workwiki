'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SaveState, submit } from '@/components/admin/SaveState';

export type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  extension: string | null;
  about: string | null;
  responseTimeNote: string | null;
  departmentId: string | null;
  locationId: string | null;
  isDefaultHr: boolean;
  fieldVisibility: Record<string, string> | null;
};

export type BindingRow = {
  id: string;
  cardId: string;
  targetType: 'node' | 'department' | 'location';
  targetLabel: string;
  purpose: string;
};

type Option = { id: string; name: string };

const BLANK = {
  name: '',
  title: '',
  email: '',
  phone: '',
  extension: '',
  about: '',
  responseTimeNote: '',
  isDefaultHr: false,
  emailVisibility: 'all',
  phoneVisibility: 'all',
};

export function ContactsEditor({
  cards,
  bindings,
  departments,
  locations,
  nodes,
}: {
  cards: ContactRow[];
  bindings: BindingRow[];
  departments: Option[];
  locations: Option[];
  nodes: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [adding, setAdding] = useState(false);

  async function run(url: string, init: RequestInit) {
    setSaved(null);
    setError(null);
    const r = await submit(url, init);
    if (r.ok) {
      setSaved(r.message);
      startTransition(() => router.refresh());
    } else {
      setError(r.message);
    }
    return r.ok;
  }

  const payload = () => ({
    name: form.name,
    title: form.title || null,
    email: form.email || null,
    phone: form.phone || null,
    extension: form.extension || null,
    about: form.about || null,
    responseTimeNote: form.responseTimeNote || null,
    isDefaultHr: form.isDefaultHr,
    fieldVisibility: {
      email: form.emailVisibility,
      phone: form.phoneVisibility,
    },
  });

  const startEdit = (c: ContactRow) => {
    setEditing(c.id);
    setAdding(false);
    setForm({
      name: c.name,
      title: c.title ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      extension: c.extension ?? '',
      about: c.about ?? '',
      responseTimeNote: c.responseTimeNote ?? '',
      isDefaultHr: c.isDefaultHr,
      emailVisibility: c.fieldVisibility?.email ?? 'all',
      phoneVisibility: c.fieldVisibility?.phone ?? 'all',
    });
  };

  return (
    <>
      <SaveState saved={saved} error={error} />

      {cards.length === 0 && !adding ? (
        <p className="lead" style={{ marginBottom: 18 }}>
          Nobody named yet. An employee who reads a page and still has a question has
          nowhere to go until there is at least one.
        </p>
      ) : null}

      <div className="rows" style={{ marginBottom: 22 }}>
        {cards.map((c) => {
          const mine = bindings.filter((b) => b.cardId === c.id);
          return (
            <div key={c.id}>
              {editing === c.id ? (
                <ContactForm
                  form={form}
                  setForm={setForm}
                  pending={pending}
                  submitLabel="Save changes"
                  onCancel={() => setEditing(null)}
                  onSubmit={async () => {
                    const ok = await run(`/api/admin/contacts/${c.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(payload()),
                    });
                    if (ok) setEditing(null);
                  }}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16 }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: 16.5 }}>
                      {c.name}
                      {c.isDefaultHr ? (
                        <span style={{ fontSize: 12.5, color: 'var(--color-accent-700)' }}>
                          {' '}· the fallback
                        </span>
                      ) : null}
                    </p>
                    {c.title ? (
                      <p style={{ margin: '0 0 2px', fontSize: 13, color: 'var(--color-neutral-700)' }}>
                        {c.title}
                      </p>
                    ) : null}
                    <p style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                      {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                    {mine.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-accent-2-700)' }}>
                        Attached to nothing — no employee page resolves to them yet.
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                        Resolves on:{' '}
                        {mine.map((b, i) => (
                          <span key={b.id}>
                            {i > 0 ? ', ' : ''}
                            {b.targetLabel}{' '}
                            <button
                              className="inline-action inline-action-destructive"
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(`/api/admin/contacts/bindings/${b.id}`, { method: 'DELETE' })
                              }
                            >
                              take off
                            </button>
                          </span>
                        ))}
                      </p>
                    )}
                    <AttachRow
                      cardId={c.id}
                      nodes={nodes}
                      departments={departments}
                      locations={locations}
                      pending={pending}
                      onAttach={(body) =>
                        run('/api/admin/contacts', { method: 'POST', body: JSON.stringify(body) })
                      }
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 14, whiteSpace: 'nowrap' }}>
                    <button className="inline-action" type="button" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <button
                      className="inline-action inline-action-destructive"
                      type="button"
                      disabled={pending}
                      onClick={() => run(`/api/admin/contacts/${c.id}`, { method: 'DELETE' })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <ContactForm
          form={form}
          setForm={setForm}
          pending={pending}
          submitLabel="Add this contact"
          onCancel={() => setAdding(false)}
          onSubmit={async () => {
            const ok = await run('/api/admin/contacts', {
              method: 'POST',
              body: JSON.stringify(payload()),
            });
            if (ok) {
              setAdding(false);
              setForm({ ...BLANK });
            }
          }}
        />
      ) : (
        <button
          className="btn"
          type="button"
          onClick={() => {
            setAdding(true);
            setEditing(null);
            setForm({ ...BLANK, isDefaultHr: cards.length === 0 });
          }}
        >
          Add a contact
        </button>
      )}
    </>
  );
}

function ContactForm({
  form,
  setForm,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  form: typeof BLANK;
  setForm: (f: typeof BLANK) => void;
  pending: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form
      style={{ display: 'grid', gap: 16, maxWidth: 620, padding: '8px 0 16px' }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <label className="field">
          <span className="eyebrow">Name</span>
          <input required maxLength={160} value={form.name} onChange={set('name')} />
        </label>
        <label className="field">
          <span className="eyebrow">Their title</span>
          <input maxLength={160} value={form.title} onChange={set('title')} />
          <span className="helper">Shown under their name.</span>
        </label>
        <label className="field">
          <span className="eyebrow">Email</span>
          <input type="email" maxLength={320} value={form.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span className="eyebrow">Phone</span>
          <input maxLength={60} value={form.phone} onChange={set('phone')} />
        </label>
        <label className="field">
          <span className="eyebrow">Who sees the email</span>
          <select value={form.emailVisibility} onChange={set('emailVisibility')}>
            <option value="all">Everyone</option>
            <option value="managers">Managers and admins</option>
            <option value="admins">Admins only</option>
          </select>
        </label>
        <label className="field">
          <span className="eyebrow">Who sees the phone</span>
          <select value={form.phoneVisibility} onChange={set('phoneVisibility')}>
            <option value="all">Everyone</option>
            <option value="managers">Managers and admins</option>
            <option value="admins">Admins only</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span className="eyebrow">What they handle</span>
        <textarea rows={2} maxLength={600} value={form.about} onChange={set('about')} />
        <span className="helper">
          &ldquo;Pay, leave, benefits, conduct.&rdquo; One line, written for the reader.
        </span>
      </label>

      <label className="field">
        <span className="eyebrow">What to expect</span>
        <input
          maxLength={200}
          value={form.responseTimeNote}
          onChange={set('responseTimeNote')}
        />
        <span className="helper">&ldquo;Replies within one business day.&rdquo;</span>
      </label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5 }}>
        <input
          type="checkbox"
          checked={form.isDefaultHr}
          onChange={(e) => setForm({ ...form, isDefaultHr: e.target.checked })}
          style={{ marginTop: 3 }}
        />
        <span>
          Use as the fallback
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-neutral-600)', maxWidth: '58ch' }}>
            Resolves on any page with nobody closer named. Only one contact can be the
            fallback; choosing this releases whoever holds it now.
          </span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <button className="btn" type="submit" disabled={pending || !form.name.trim()}>
          {submitLabel}
        </button>
        <button className="inline-action" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AttachRow({
  cardId,
  nodes,
  departments,
  locations,
  pending,
  onAttach,
}: {
  cardId: string;
  nodes: Option[];
  departments: Option[];
  locations: Option[];
  pending: boolean;
  onAttach: (body: Record<string, unknown>) => void;
}) {
  const [type, setType] = useState<'node' | 'department' | 'location'>('node');
  const [target, setTarget] = useState('');
  const [purpose, setPurpose] = useState('Who to ask');

  const options = type === 'node' ? nodes : type === 'department' ? departments : locations;
  if (options.length === 0 && type === 'node') return null;

  return (
    <form
      style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        onAttach({ bind: true, cardId, targetType: type, targetId: target, purpose });
        setTarget('');
      }}
    >
      <label className="field">
        <span className="eyebrow">Attach to</span>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as typeof type);
            setTarget('');
          }}
          style={{ fontSize: 13 }}
        >
          <option value="node">A section or page</option>
          <option value="department">A department</option>
          <option value="location">A site</option>
        </select>
      </label>
      <label className="field">
        <span className="eyebrow">Which</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="eyebrow">Labelled</span>
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          maxLength={80}
          style={{ fontSize: 13, width: 160 }}
        />
      </label>
      <button className="inline-action" type="submit" disabled={pending || !target}>
        Attach
      </button>
    </form>
  );
}
