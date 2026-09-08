'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** Always on screen. Search is the primary navigation; browse is the fallback. */
export function SearchField() {
  const params = useSearchParams();
  const router = useRouter();
  const [value, setValue] = useState(params.get('q') ?? '');

  return (
    <form
      className="no-print"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <label className="field" style={{ maxWidth: 620, marginBottom: 10 }}>
        <span>Search</span>
        <input
          className="input"
          type="search"
          name="q"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask it the way you would ask a person"
        />
      </label>
    </form>
  );
}
