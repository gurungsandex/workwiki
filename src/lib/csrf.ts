import { cookies, headers } from 'next/headers';
import { env } from '@/env';
import { constantTimeEquals } from '@/lib/crypto';

/**
 * Mutations are CSRF-protected two ways, and both must pass:
 *
 *  1. The request's Origin (or Referer) must be this deployment. A cross-site
 *     form post has neither.
 *  2. A double-submit token: a cookie the browser holds and a header or form
 *     field the page had to read to send.
 */

import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER } from './csrf-shared';

export { CSRF_FIELD, CSRF_HEADER };

/**
 * Read the token the middleware minted for this browser. A server component
 * may not set a cookie, so minting happens there and reading happens here.
 */
export async function csrfToken(): Promise<string> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? '';
}

export class CsrfError extends Error {
  constructor(message = 'This request could not be verified. Reload the page and try again.') {
    super(message);
    this.name = 'CsrfError';
  }
}

function sameOrigin(candidate: string | null): boolean {
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === new URL(env.APP_BASE_URL).origin;
  } catch {
    return false;
  }
}

/** Throws CsrfError unless both checks pass. Call at the top of every mutation. */
export async function assertCsrf(submitted?: string | null): Promise<void> {
  const hdrs = await headers();

  const origin = hdrs.get('origin');
  const referer = hdrs.get('referer');
  if (origin ? !sameOrigin(origin) : !sameOrigin(referer)) throw new CsrfError();

  const store = await cookies();
  const expected = store.get(CSRF_COOKIE)?.value;
  const provided = submitted ?? hdrs.get(CSRF_HEADER);
  if (!expected || !provided || !constantTimeEquals(expected, provided)) throw new CsrfError();
}
