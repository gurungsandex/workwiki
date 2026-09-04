import type { Sql } from 'postgres';
import { z } from 'zod';
import { audit } from '@/lib/audit/write';
import { hashToken, newToken } from '@/lib/auth/tokens';

/**
 * People and invites.
 *
 * An admin creates the record — the dimensions and the hire date are what the
 * access engine evaluates — and generates a link the person redeems to set a
 * password. The platform never invents an employee's department for them.
 */

type Failure = { ok: false; error: string };

export const personInput = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email().max(320),
  departmentId: z.string().uuid().nullable().optional(),
  roleId: z.string().uuid().nullable().optional(),
  employeeTypeId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  hoursPerWeek: z.number().min(0).max(200).nullable().optional(),
  /** The hire date lives once, as a tenure anchor. There is no second copy. */
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createPerson(
  sql: Sql,
  input: z.infer<typeof personInput>,
  actorUserId: string,
): Promise<{ ok: true; userId: string; message: string } | Failure> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM app_user WHERE email = ${input.email}`;
  if (existing.length > 0) {
    return { ok: false, error: `${input.email} is already on the roster.` };
  }

  return sql.begin(async (tx) => {
    const users = await tx<{ id: string }[]>`
      INSERT INTO app_user (email, status, is_admin)
      VALUES (${input.email}, 'invited', false)
      RETURNING id`;
    const userId = users[0]!.id;

    await tx`
      INSERT INTO employee_profile
        (user_id, display_name, department_id, role_id, employee_type_id,
         location_id, hours_per_week)
      VALUES (${userId}::uuid, ${input.displayName.trim()},
              ${input.departmentId ?? null}::uuid, ${input.roleId ?? null}::uuid,
              ${input.employeeTypeId ?? null}::uuid, ${input.locationId ?? null}::uuid,
              ${input.hoursPerWeek ?? null})`;

    await tx`
      INSERT INTO tenure_anchor (user_id, key, date, source)
      VALUES (${userId}::uuid, 'hire_date', ${input.hireDate}::date, 'admin')`;

    await audit(tx, {
      actorUserId,
      action: 'people.create',
      area: 'People',
      targetType: 'app_user',
      targetId: userId,
      after: { displayName: input.displayName },
    });

    return {
      ok: true as const,
      userId,
      message: `${input.displayName} added. They cannot sign in until you give them an invite link.`,
    };
  });
}

const INVITE_DAYS = 14;

export async function createInvite(
  sql: Sql,
  userId: string,
  actorUserId: string,
): Promise<{ ok: true; token: string; expiresAt: string; message: string } | Failure> {
  const rows = await sql<{ email: string; display_name: string; status: string }[]>`
    SELECT u.email, p.display_name, u.status
      FROM app_user u JOIN employee_profile p ON p.user_id = u.id
     WHERE u.id = ${userId}::uuid AND u.archived_at IS NULL`;
  const person = rows[0];
  if (!person) return { ok: false, error: 'That person is not on the roster.' };
  if (person.status === 'deactivated') {
    return { ok: false, error: `${person.display_name} is deactivated. Reactivate them first.` };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);

  return sql.begin(async (tx) => {
    // One live invite per person: issuing a new one revokes the old, so a link
    // that leaked stops working the moment a replacement is made.
    await tx`
      UPDATE invite SET revoked_at = now()
       WHERE email = ${person.email} AND revoked_at IS NULL AND redeemed_at IS NULL`;

    await tx`
      INSERT INTO invite (token_hash, email, created_by, expires_at, max_uses)
      VALUES (${hashToken(token)}, ${person.email}, ${actorUserId}::uuid, ${expiresAt}, 1)`;

    await audit(tx, {
      actorUserId,
      action: 'people.invite',
      area: 'People',
      targetType: 'app_user',
      targetId: userId,
    });

    return {
      ok: true as const,
      token,
      expiresAt: expiresAt.toISOString(),
      message: `Invite link made for ${person.display_name}. It works once, expires in ${INVITE_DAYS} days, and replaces any earlier link.`,
    };
  });
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * Redeeming an invite: the person sets a password and the account activates.
 *
 * The token is compared by hash and consumed inside the transaction, so two
 * simultaneous redemptions cannot both succeed.
 */
export async function redeemInvite(
  sql: Sql,
  token: string,
  passwordHash: string,
): Promise<RedeemResult> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; email: string; use_count: number; max_uses: number }[]>`
      SELECT id, email, use_count, max_uses FROM invite
       WHERE token_hash = ${hashToken(token)}
         AND revoked_at IS NULL
         AND redeemed_at IS NULL
         AND expires_at > now()
       FOR UPDATE`;
    const invite = rows[0];
    // One message for expired, revoked, already-used and never-existed alike:
    // a link that is no good should not reveal which kind of no good it is.
    if (!invite) return { ok: false as const, error: 'That link is no longer valid. Ask for a new one.' };

    const users = await tx<{ id: string; status: string }[]>`
      SELECT id, status FROM app_user
       WHERE email = ${invite.email} AND archived_at IS NULL FOR UPDATE`;
    const user = users[0];
    if (!user) return { ok: false as const, error: 'That link is no longer valid. Ask for a new one.' };

    await tx`
      UPDATE app_user
         SET password_hash = ${passwordHash},
             status = 'active',
             email_verified_at = COALESCE(email_verified_at, now()),
             updated_at = now()
       WHERE id = ${user.id}::uuid`;

    await tx`
      UPDATE invite SET redeemed_at = now(), redeemed_by = ${user.id}::uuid,
             use_count = use_count + 1
       WHERE id = ${invite.id}::uuid`;

    await audit(tx, {
      actorUserId: user.id,
      action: 'people.invite_redeemed',
      area: 'People',
      targetType: 'app_user',
      targetId: user.id,
    });

    return { ok: true as const, userId: user.id };
  });
}

export async function setPersonStatus(
  sql: Sql,
  userId: string,
  status: 'active' | 'deactivated',
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ display_name: string }[]>`
      SELECT p.display_name FROM app_user u
        JOIN employee_profile p ON p.user_id = u.id
       WHERE u.id = ${userId}::uuid AND u.archived_at IS NULL FOR UPDATE OF u`;
    if (!rows[0]) return { ok: false as const, error: 'That person is not on the roster.' };

    await tx`UPDATE app_user SET status = ${status}, updated_at = now()
              WHERE id = ${userId}::uuid`;

    if (status === 'deactivated') {
      // Revocation is a delete, so it takes effect on their next request.
      await tx`DELETE FROM session WHERE user_id = ${userId}::uuid`;
    }

    await audit(tx, {
      actorUserId,
      action: `people.${status}`,
      area: 'People',
      targetType: 'app_user',
      targetId: userId,
      after: { status },
    });

    return {
      ok: true as const,
      message:
        status === 'deactivated'
          ? `${rows[0]!.display_name} deactivated and signed out everywhere. Their acknowledgments are kept — those are a record of what they read.`
          : `${rows[0]!.display_name} reactivated. They can sign in again with their existing password.`,
    };
  });
}
