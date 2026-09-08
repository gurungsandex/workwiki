import { describe, expect, it } from 'vitest';
import { initialKeys, keyBetween } from '@/lib/sort-key';

describe('fractional sort keys', () => {
  it('appends in increasing order', () => {
    const keys = initialKeys(50);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(50);
  });

  it('inserts strictly between two neighbours', () => {
    const keys = initialKeys(3);
    const [a, b] = keys as [string, string];
    const mid = keyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('survives repeated insertion at the same point — a drag handle used hard', () => {
    let low = keyBetween(null, null);
    let high = keyBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(low, high);
      expect(low < mid && mid < high).toBe(true);
      high = mid;
    }
    expect(low < high).toBe(true);
  });

  it('prepends before the first key', () => {
    const first = keyBetween(null, null);
    const before = keyBetween(null, first);
    expect(before < first).toBe(true);
    const beforeThat = keyBetween(null, before);
    expect(beforeThat < before).toBe(true);
  });

  it('refuses keys given in the wrong order', () => {
    expect(() => keyBetween('c', 'a')).toThrow(/out of order/);
  });
});
