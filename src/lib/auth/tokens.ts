import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { authTokens } from '@/db/schema';
import { hashToken, newToken } from '@/lib/crypto';

/** Single-use, expiring tokens: verification, reset, invite redemption. */

export type TokenPurpose = 'verify_email' | 'password_reset' | 'invite';

const TTL_SECONDS: Record<TokenPurpose, number> = {
  verify_email: 60 * 60 * 24 * 3,
  password_reset: 60 * 60,
  invite: 60 * 60 * 24 * 14,
};

export async function issueToken(input: {
  purpose: TokenPurpose;
  userId?: string | null;
  email?: string | null;
  payload?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + TTL_SECONDS[input.purpose] * 1000);
  const [row] = await db
    .insert(authTokens)
    .values({
      purpose: input.purpose,
      userId: input.userId ?? null,
      email: input.email ?? null,
      payload: input.payload ?? {},
      createdBy: input.createdBy ?? null,
      tokenHash: hashToken(token),
      expiresAt,
    })
    .returning({ id: authTokens.id });
  return { token, id: row!.id, expiresAt };
}

export interface RedeemedToken {
  id: string;
  userId: string | null;
  email: string | null;
  payload: Record<string, unknown>;
}

/** Look without consuming — for the "set your password" form's first render. */
export async function peekToken(purpose: TokenPurpose, token: string): Promise<RedeemedToken | null> {
  const rows = await db
    .select({
      id: authTokens.id,
      userId: authTokens.userId,
      email: authTokens.email,
      payload: authTokens.payload,
    })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        isNull(authTokens.revokedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Consume atomically: the UPDATE … WHERE consumed_at IS NULL is the lock, so
 * two simultaneous redemptions cannot both succeed.
 */
export async function consumeToken(purpose: TokenPurpose, token: string): Promise<RedeemedToken | null> {
  const rows = await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
        isNull(authTokens.revokedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({
      id: authTokens.id,
      userId: authTokens.userId,
      email: authTokens.email,
      payload: authTokens.payload,
    });
  return rows[0] ?? null;
}

export async function revokeTokens(purpose: TokenPurpose, userId: string): Promise<void> {
  await db
    .update(authTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(authTokens.purpose, purpose), eq(authTokens.userId, userId), isNull(authTokens.consumedAt)));
}
