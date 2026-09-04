import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { verifyPassword, hashPassword, needsRehash } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import {
  checkRateLimit,
  clearAttempts,
  recordAttempt,
  sleep,
} from '@/lib/auth/rate-limit';
import { audit } from '@/lib/audit/write';
import { clientIp, json, problem } from '@/lib/http';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

const body = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

/**
 * Login.
 *
 * The failure message is identical for an unknown address and a wrong password,
 * and the code path does the same work either way — a dummy verify runs when
 * the user does not exist, so response time does not disclose existence.
 */
const GENERIC_FAILURE = 'That email address and password do not match.';

// A real Argon2id hash of a value nobody knows, for the timing-equalising path.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0Fh3vJcMkQCtN0nJ8vXqO7hUJ2sTgB1kL9pWmYzRxAo';

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, GENERIC_FAILURE);

  const { email, password } = parsed.data;
  const ip = await clientIp();
  const db = sql();

  const verdict = await checkRateLimit(db, 'login', email, ip);
  if (!verdict.allowed) {
    return problem(429, 'Too many attempts. Wait a few minutes and try again.', {
      retryAfter: verdict.retryAfterSec,
    });
  }
  if (verdict.delayMs > 0) await sleep(verdict.delayMs);
  await recordAttempt(db, 'login', email, ip);

  const rows = await db<
    { id: string; password_hash: string | null; status: string; locked_until: Date | null }[]
  >`SELECT id, password_hash, status, locked_until FROM app_user
     WHERE email = ${email} AND archived_at IS NULL`;

  const user = rows[0];
  const encoded = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(encoded, password);

  if (!user || !passwordOk || user.status !== 'active') {
    if (user) {
      await db`UPDATE app_user SET failed_attempts = failed_attempts + 1
                WHERE id = ${user.id}::uuid`;
    }
    return problem(401, GENERIC_FAILURE);
  }

  if (user.locked_until && user.locked_until > new Date()) {
    return problem(401, GENERIC_FAILURE);
  }

  // Rehash transparently when the configured cost has been raised.
  if (needsRehash(encoded)) {
    await db`UPDATE app_user SET password_hash = ${await hashPassword(password)}
              WHERE id = ${user.id}::uuid`;
  }

  await db`UPDATE app_user SET failed_attempts = 0, locked_until = NULL
            WHERE id = ${user.id}::uuid`;
  await clearAttempts(db, 'login', email);

  const ua = (await headers()).get('user-agent') ?? undefined;
  const token = await createSession(db, user.id, { ip: ip ?? undefined, userAgent: ua });
  await setSessionCookie(token);

  await audit(db, {
    actorUserId: user.id,
    action: 'auth.login',
    area: 'People',
    targetType: 'app_user',
    targetId: user.id,
    ip,
  });

  return json({ ok: true });
}
