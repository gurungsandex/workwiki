'use client';

/**
 * The save-state line.
 *
 * Every mutation writes a human sentence here. The strings are part of the
 * design: they say what now works or what widened, never "saved successfully".
 */
export function SaveState({ saved, error }: { saved: string | null; error: string | null }) {
  if (!saved && !error) return null;
  return (
    <p
      role={error ? 'alert' : 'status'}
      style={{
        margin: '0 0 14px',
        fontSize: 13,
        lineHeight: 1.55,
        maxWidth: '66ch',
        color: error ? 'var(--color-accent-2-700)' : 'var(--color-accent-700)',
      }}
    >
      {error ?? saved}
    </p>
  );
}

/** Calls a JSON endpoint and surfaces its message or error. */
export async function submit(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; message: string | null }> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return {
    ok: response.ok,
    message: response.ok ? (data.message ?? null) : (data.error ?? 'That did not go through.'),
  };
}
