import { createHash } from 'node:crypto';

/**
 * The canonicalisation a page_version's content_hash is taken over.
 *
 * The spec says the acknowledgment POST carries "the page_version_id and content
 * hash the client rendered" and that a mismatch is rejected, but does not say
 * what is hashed. It is pinned here, once, because changing it later invalidates
 * every stored acknowledgment:
 *
 *   - the input is the page_version snapshot, NOT the rendered HTML and NOT the
 *     access-filtered view (a subject-dependent hash could not be unique per
 *     (user, version), which the schema requires)
 *   - object keys are sorted lexicographically at every depth
 *   - no insignificant whitespace: JSON.stringify with no spacing
 *   - undefined members are dropped; null is preserved
 *   - the digest is sha256 over the UTF-8 bytes, hex-encoded
 *
 * The client recomputes it from the same snapshot it was served, so a page that
 * changed under a reader is rejected rather than silently attested.
 */

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value instanceof Date) return value.toISOString();
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    if (src[key] === undefined) continue;
    out[key] = sortDeep(src[key]);
  }
  return out;
}

export function contentHash(snapshot: unknown): Buffer {
  return createHash('sha256').update(canonicalJSON(snapshot), 'utf8').digest();
}

export function contentHashHex(snapshot: unknown): string {
  return contentHash(snapshot).toString('hex');
}
