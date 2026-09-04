import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request security headers.
 *
 * CSP carries a nonce, so it lives here rather than in next.config.ts. There
 * are no inline event handlers anywhere in this app and no eval, so the policy
 * needs neither 'unsafe-inline' nor 'unsafe-eval' in production.
 *
 * Also enforces CSRF on mutations: the session cookie is SameSite=Lax, which
 * stops cross-site POSTs from carrying it, and this adds an Origin check as the
 * second lock (spec §9, "CSRF-protected on mutations").
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function middleware(request: NextRequest) {
  // --- CSRF: same-origin check on every mutating request ------------------
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin');
    const expected = new URL(request.url).origin;
    // A missing Origin on a mutation is not a browser we want to trust.
    if (!origin || origin !== expected) {
      return NextResponse.json(
        { error: 'This request did not come from this site.' },
        { status: 403 },
      );
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    `default-src 'self'`,
    // Next injects a small bootstrap script; the nonce covers it. strict-dynamic
    // lets that bootstrap load the chunks it needs without widening the policy.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Source Serif 4 is self-hosted in production; the style nonce covers the
    // few style tags Next emits.
    `style-src 'self' 'nonce-${nonce}'`,
    `font-src 'self'`,
    // Files are proxied through an access-checked route, so images are same-origin.
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // Never let a browser or proxy cache an access-filtered response.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, private');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
