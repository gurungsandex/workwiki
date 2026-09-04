'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <form
      style={{ display: 'grid', gap: 18 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirm) {
          setError('Those two do not match.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const response = await fetch('/api/auth/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password }),
          });
          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? 'That did not work.');
            return;
          }
          router.push('/home');
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span className="eyebrow">Choose a password</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="helper">At least 12 characters. Length beats punctuation.</span>
      </label>

      <label className="field">
        <span className="eyebrow">Type it again</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch ? (
          <span className="helper helper-required">Those two do not match.</span>
        ) : null}
      </label>

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-2-700)' }}>
          {error}
        </p>
      ) : null}

      <div>
        <button className="btn" type="submit" disabled={busy || mismatch || !password}>
          {busy ? 'Setting it…' : 'Set my password'}
        </button>
      </div>
    </form>
  );
}
