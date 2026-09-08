import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

/** Opaque, high-entropy token. 256 bits, URL-safe. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** What gets stored. The token itself never touches the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * IP addresses are never stored. This keyed hash is enough to rate-limit and
 * to say "a different device" in the session list, and useless as a locator.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', env.SESSION_SECRET).update(ip).digest('hex').slice(0, 32);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Still burn a comparison so length is the only thing timing reveals.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Stable hash of a published page's blocks — what an acknowledgment attests. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
