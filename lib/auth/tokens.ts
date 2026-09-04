import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
 *
 * Reads SESSION_SECRET directly rather than through the validated env object.
 * This runs on paths that must not be able to take the process down — a
 * throttled login is exactly when you least want a boot-time validator to fire
 * — and it needs one variable, not the whole environment.
 */
export function pseudonymise(value: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed and loudly at the call site, not by exiting the process.
    throw new Error('SESSION_SECRET is missing or too short; cannot pseudonymise.');
  }
  return createHash('sha256')
    .update(secret, 'utf8')
    .update('\x00')
    .update(value, 'utf8')
    .digest();
}
