import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Opaque tokens. 256 bits of randomness, stored hashed, compared in constant
 * time. Nothing reversible is kept: a database read cannot mint a session.
 */

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function tokensEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A keyed hash for values we must be able to correlate but never read back:
 * client IPs in the audit log and the rate limiter.
 */
export function pseudonymise(value: string): Buffer {
  return createHash('sha256')
    .update(env().SESSION_SECRET, 'utf8')
    .update('\x00')
    .update(value, 'utf8')
    .digest();
}
