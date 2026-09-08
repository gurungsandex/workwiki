import { headers } from 'next/headers';
import { db } from '@/db/client';
import { auditEvents } from '@/db/schema';
import { hashIp } from '@/lib/crypto';
import { clientIp } from '@/lib/auth/session';

/**
 * The audit log is append-only — there is no update path and no delete path in
 * this module, and the database refuses both regardless (see migration 0002).
 * Reporting-line overrides, company-detail saves and issue resolutions all
 * append here.
 */

export type AuditArea = 'Content' | 'Documents' | 'People' | 'Access' | 'Setup' | 'Auth';

/** Fields that must never reach the audit diff, however they are nested. */
const REDACTED = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'tokenHash',
  'token_hash',
  'totpSecretEnc',
  'totp_secret_enc',
  'sessionSecret',
  'hireDate',
  'hire_date',
  'dateOfBirth',
  'date_of_birth',
  'ssn',
  'governmentId',
  'government_id',
  'pay',
  'salary',
  'compensation',
  'workPhone',
  'work_phone',
  'phone',
  'mainPhone',
  'main_phone',
  'email',
  'workEmail',
  'work_email',
]);

/** PII and secrets out of the diff, structure intact so the change stays legible. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED.has(key) ? '[redacted]' : redact(inner);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  area: AuditArea;
  /** The human sentence the console shows. Say what now works, or what moved. */
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function appendAudit(input: AuditInput): Promise<void> {
  let ipHash: string | null = null;
  try {
    ipHash = hashIp(clientIp(await headers()));
  } catch {
    // Outside a request (a worker job, a seed script): no address to hash.
  }

  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    action: input.action,
    area: input.area,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    summary: input.summary,
    before: (input.before === undefined ? null : redact(input.before)) as Record<string, unknown> | null,
    after: (input.after === undefined ? null : redact(input.after)) as Record<string, unknown> | null,
    ipHash,
  });
}
