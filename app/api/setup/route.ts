import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { hashPassword, passwordProblems } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { audit } from '@/lib/audit/write';
import { clientIp, json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const body = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
  displayName: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64),
});

/**
 * Creates the first admin. Guarded by the absence of any admin, checked inside
 * the transaction with a lock, so this endpoint cannot be raced into creating
 * a second "first" admin on a running instance.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'Those details were not understood.');

  const problems = passwordProblems(parsed.data.password);
  if (problems.length > 0) return problem(400, problems.join(' '));

  // Validate the timezone before storing it: tenure math depends on it.
  try {
    new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone });
  } catch {
    return problem(400, `"${parsed.data.timezone}" is not a timezone this server knows.`);
  }

  const db = sql();
  const passwordHash = await hashPassword(parsed.data.password);

  const result = await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(918273645)`;

    const existing = await tx<{ n: string }[]>`
      SELECT count(*)::text AS n FROM app_user WHERE is_admin`;
    if (Number(existing[0]!.n) > 0) {
      return { ok: false as const, error: 'This instance is already set up.' };
    }

    const [user] = await tx<{ id: string }[]>`
      INSERT INTO app_user (email, password_hash, status, is_admin, email_verified_at)
      VALUES (${parsed.data.email}, ${passwordHash}, 'active', true, now())
      RETURNING id`;

    await tx`
      INSERT INTO company_setting (display_name, timezone)
      VALUES (${parsed.data.companyName}, ${parsed.data.timezone})
      ON CONFLICT (singleton) DO UPDATE
        SET display_name = EXCLUDED.display_name, timezone = EXCLUDED.timezone`;

    await tx`
      INSERT INTO employee_profile (user_id, display_name)
      VALUES (${user!.id}::uuid, ${parsed.data.displayName})`;

    // The first admin's own hire date, so they can preview as themselves.
    await tx`
      INSERT INTO tenure_anchor (user_id, key, date, source)
      VALUES (${user!.id}::uuid, 'hire_date', current_date, 'admin')`;

    await audit(tx, {
      actorUserId: user!.id,
      action: 'setup.first_admin',
      area: 'Setup',
      targetType: 'app_user',
      targetId: user!.id,
      after: { companyName: parsed.data.companyName },
    });

    return { ok: true as const, userId: user!.id };
  });

  if (!result.ok) return problem(409, result.error);

  const token = await createSession(db, result.userId, {
    ip: (await clientIp()) ?? undefined,
  });
  await setSessionCookie(token);
  return json({ ok: true });
}
