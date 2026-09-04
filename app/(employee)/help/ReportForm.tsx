'use client';

import { useState } from 'react';

const KINDS = [
  'Something is missing',
  'Something is wrong',
  'I cannot read it',
  'A link is broken',
] as const;

export function ReportForm() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>(KINDS[0]);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-700)' }}>
        Sent. Whoever resolves it has to say what changed, and you will get those words
        back.
      </p>
    );
  }

  return (
    <form
      style={{ display: 'grid', gap: 16, maxWidth: 520 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const response = await fetch('/api/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, body }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? 'That did not send.');
          return;
        }
        setSent(true);
      }}
    >
      <label className="field">
        <span className="eyebrow">What kind of problem</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="eyebrow">What is wrong</span>
        <textarea
          rows={4}
          required
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-2-700)' }}>
          {error}
        </p>
      ) : null}

      <div>
        <button className="btn" type="submit">Send this report</button>
      </div>
    </form>
  );
}
