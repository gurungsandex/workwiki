import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { hashPassword, passwordProblems } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { redeemInvite } from '@/lib/people/manage';
import { checkRateLimit, recordAttempt, sleep } from '@/lib/auth/rate-limit';
import { clientIp, json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(1024),
});

/** Redeeming an invite. Throttled like any other credential-bearing endpoint. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That link is no longer valid. Ask for a new one.');

  const problems = passwordProblems(parsed.data.password);
  if (problems.length > 0) return problem(400, problems.join(' '));

  const db = sql();
  const ip = await clientIp();

  const verdict = await checkRateLimit(db, 'invite', null, ip);
  if (!verdict.allowed) {
    return problem(429, 'Too many attempts. Wait a few minutes and try again.');
  }
  if (verdict.delayMs > 0) await sleep(verdict.delayMs);
  await recordAttempt(db, 'invite', null, ip);

  const result = await redeemInvite(db, parsed.data.token, await hashPassword(parsed.data.password));
  if (!result.ok) return problem(400, result.error);

  const token = await createSession(db, result.userId, { ip: ip ?? undefined });
  await setSessionCookie(token);
  return json({ ok: true });
}
