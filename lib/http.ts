import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { env } from './env';

/** Responses that carry access-filtered content must never be cached. */
export function json(body: unknown, init: ResponseInit = {}) {
  const res = NextResponse.json(body, init);
  res.headers.set('Cache-Control', 'no-store, private');
  return res;
}

export function problem(status: number, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, { status });
}

/**
 * The client IP, for rate limiting and pseudonymised audit entries.
 *
 * X-Forwarded-For is only believed when TRUST_PROXY is on, because a client can
 * set that header itself and would otherwise be able to rotate past the limiter.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  if (env().TRUST_PROXY) {
    const xff = h.get('x-forwarded-for');
    if (xff) return xff.split(',')[0]!.trim();
    const real = h.get('x-real-ip');
    if (real) return real.trim();
  }
  return null;
}

export async function cspNonce(): Promise<string> {
  return (await headers()).get('x-nonce') ?? '';
}
