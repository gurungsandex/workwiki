'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** Search is the primary navigation and is always on screen. */
export function SearchField() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/browse?q=${encodeURIComponent(q)}`);
      }}
    >
      <label className="field">
        <span className="eyebrow">Search the handbook</span>
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="when do I get insurance"
          style={{ width: '100%', maxWidth: 520, fontSize: 16 }}
        />
      </label>
    </form>
  );
}
