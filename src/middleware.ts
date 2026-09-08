import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE } from '@/lib/csrf-shared';

/**
 * Security headers on every response.
 *
 * The CSP is strict and nonce-based: no inline event handlers, no `unsafe-eval`
 * in production, nothing framed, and no third-party origin — which is why the
 * typeface is self-hosted rather than pulled from a font CDN.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const secure = request.nextUrl.protocol === 'https:';

  /*
   * Mint the CSRF cookie here rather than during render: a server component
   * may not set a cookie, and every page needs the token to be present before
   * its first form is drawn.
   */
  let csrf = request.cookies.get(CSRF_COOKIE)?.value;
  const mintedCsrf = !csrf;
  if (!csrf) {
    csrf = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    request.cookies.set(CSRF_COOKIE, csrf);
  }
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    `default-src 'self'`,
    // Next's hydration payload needs the nonce; dev additionally needs eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Stylesheets and <style> elements stay nonce-gated…
    `style-src-elem 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ''}`,
    // …while element style attributes are permitted: the Broadsheet screens
    // carry their measurements inline, and a style attribute cannot execute.
    `style-src-attr 'unsafe-inline'`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `manifest-src 'self'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  /*
   * A cookie minted here is not in the incoming Cookie header, so the very
   * first render would read no token and every form on that page would fail
   * its own check. Forward the mutated cookie jar explicitly.
   */
  if (mintedCsrf) headers.set('cookie', request.cookies.toString());

  const response = NextResponse.next({ request: { headers } });

  if (mintedCsrf) {
    response.cookies.set(CSRF_COOKIE, csrf, {
      httpOnly: false, // the page must read it to echo it back
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
    });
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  );
  // HTTPS is assumed behind a proxy and documented as such.
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
