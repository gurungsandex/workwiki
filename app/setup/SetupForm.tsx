'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC'];

export function SetupForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    companyName: '',
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      style={{ display: 'grid', gap: 18 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('/api/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          });
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? 'Setup did not complete.');
            return;
          }
          router.push('/admin');
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span className="eyebrow">Company display name</span>
        <input required maxLength={200} value={form.companyName} onChange={set('companyName')} />
        <span className="helper">What employees see at the top of their handbook.</span>
      </label>

      <label className="field">
        <span className="eyebrow">Default timezone</span>
        <select value={form.timezone} onChange={set('timezone')}>
          {ZONES.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <span className="helper">
          Dates unlock at local midnight. Each site can override this later.
        </span>
      </label>

      <label className="field">
        <span className="eyebrow">Your name</span>
        <input required maxLength={200} value={form.displayName} onChange={set('displayName')} />
      </label>

      <label className="field">
        <span className="eyebrow">Your work email</span>
        <input type="email" required autoComplete="username" value={form.email} onChange={set('email')} />
      </label>

      <label className="field">
        <span className="eyebrow">Your password</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
        />
        <span className="helper">At least 12 characters. Length beats punctuation.</span>
      </label>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-2-700)' }}>
          {error}
        </p>
      ) : null}

      <div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Setting up…' : 'Create this instance'}
        </button>
      </div>
    </form>
  );
}
