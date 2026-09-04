'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AcknowledgeButton({
  pageVersionId,
  contentHashHex,
  alreadyAcknowledged,
}: {
  pageVersionId: string;
  contentHashHex: string;
  alreadyAcknowledged: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState(alreadyAcknowledged);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-700)' }}>
        Acknowledged. If this policy is published again, it will come back here.
      </p>
    );
  }

  return (
    <div>
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch('/api/acknowledgments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageVersionId, contentHashHex }),
            });
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) {
              setError(data.error ?? 'That did not go through.');
              return;
            }
            setDone(true);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Recording…' : 'I have read this'}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--color-accent-2-700)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
