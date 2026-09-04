import { describe, it, expect } from 'vitest';
import { midKey } from '@/lib/content/manage';

/**
 * Fractional ordering. A move must be a single-row UPDATE, which is only true
 * if a key can always be produced strictly between two neighbours without
 * rewriting either.
 */
describe('midKey', () => {
  it('produces a key between two ends', () => {
    const k = midKey(null, null);
    expect(k.length).toBeGreaterThan(0);
  });

  it('appends after a last key', () => {
    const a = midKey(null, null);
    const b = midKey(a, null);
    expect(b > a).toBe(true);
  });

  it('prepends before a first key', () => {
    const a = midKey(null, null);
    const b = midKey(null, a);
    expect(b < a).toBe(true);
  });

  it('lands strictly between two adjacent keys', () => {
    const a = 'a';
    const b = 'b';
    const mid = midKey(a, b);
    expect(mid > a).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('survives repeated insertion at the same spot', () => {
    // The pathological case: always insert between the first two.
    let keys = [midKey(null, null)];
    keys.push(midKey(keys[0]!, null));
    for (let i = 0; i < 200; i++) {
      const mid = midKey(keys[0]!, keys[1]!);
      expect(mid > keys[0]!).toBe(true);
      expect(mid < keys[1]!).toBe(true);
      keys = [keys[0]!, mid, ...keys.slice(1)];
    }
    // Still sorted, still unique.
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps a list ordered through many random moves', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // Build 30 items appended in order.
    const items: { id: number; key: string }[] = [];
    for (let i = 0; i < 30; i++) {
      items.push({ id: i, key: midKey(items[items.length - 1]?.key ?? null, null) });
    }

    for (let move = 0; move < 300; move++) {
      items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const from = Math.floor(rnd() * items.length);
      const to = Math.floor(rnd() * items.length);
      if (from === to) continue;
      const moved = items[from]!;
      const rest = items.filter((_, i) => i !== from);
      const before = rest[to - 1]?.key ?? null;
      const after = rest[to]?.key ?? null;
      moved.key = midKey(before, after);

      if (before !== null) expect(moved.key > before).toBe(true);
      if (after !== null) expect(moved.key < after).toBe(true);
    }

    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never returns a key equal to either bound', () => {
    const pairs: [string | null, string | null][] = [
      [null, null], ['a', 'b'], ['a', 'ab'], ['zz', null], [null, '1'], ['m', 'n'],
    ];
    for (const [lo, hi] of pairs) {
      const mid = midKey(lo, hi);
      expect(mid).not.toBe(lo);
      expect(mid).not.toBe(hi);
      if (lo !== null) expect(mid > lo).toBe(true);
      if (hi !== null) expect(mid < hi).toBe(true);
    }
  });

  /**
   * The scheme's one precondition: nothing can sort before the floor digit, so
   * '0' must never BE a key. Everything below it is reachable as '0…' only
   * while that holds, which is why midKey never returns the bare floor.
   */
  it('never returns the bare floor digit, so there is always room below', () => {
    const generated = [midKey(null, null), midKey(null, '1'), midKey(null, 'a')];
    for (const k of generated) expect(k).not.toBe('0');

    // And a key generated at the very bottom still leaves room beneath it.
    let lowest = midKey(null, null);
    for (let i = 0; i < 50; i++) {
      const next = midKey(null, lowest);
      expect(next < lowest).toBe(true);
      expect(next).not.toBe('0');
      lowest = next;
    }
  });
});
