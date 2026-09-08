/**
 * Fractional indexing, so a drag-and-drop is a single-row update rather than a
 * renumbering of the whole list. A key is a base-36 fraction written without
 * the leading "0."; keys order lexicographically, and one can always be made
 * between any two others.
 */

const BASE = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Keys never end in '0' — that is what keeps "between" always solvable. */
function assertKey(key: string, label: string): void {
  if (key.length === 0) throw new RangeError(`${label} sort key is empty`);
  if (key.endsWith('0')) throw new RangeError(`${label} sort key ends in a zero: ${key}`);
  for (const char of key) {
    if (!BASE.includes(char)) throw new RangeError(`${label} sort key has a stray character: ${key}`);
  }
}

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RangeError(`sort keys out of order: ${a} >= ${b}`);

  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) shared++;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }

  const low = a.length > 0 ? BASE.indexOf(a[0]!) : 0;
  const high = b !== null ? BASE.indexOf(b[0]!) : BASE.length;

  if (high - low > 1) return BASE[Math.round(0.5 * (low + high))]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return BASE[low]! + midpoint(a.slice(1), null);
}

/**
 * A key strictly between `before` and `after`. Either may be null, meaning
 * the start or the end of the list.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null) assertKey(before, 'before');
  if (after !== null) assertKey(after, 'after');
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`sort keys out of order: ${before} >= ${after}`);
  }
  return midpoint(before ?? '', after);
}

/** n evenly spaced keys, for seeding a fresh list in one pass. */
export function initialKeys(count: number): string[] {
  if (count <= 0) return [];
  if (count < BASE.length - 1) {
    const step = (BASE.length - 1) / (count + 1);
    return Array.from({ length: count }, (_, i) => BASE[Math.max(1, Math.round((i + 1) * step))]!);
  }
  const keys: string[] = [];
  let previous: string | null = null;
  for (let i = 0; i < count; i++) {
    previous = keyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}
