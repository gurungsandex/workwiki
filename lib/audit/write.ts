import type { Sql } from 'postgres';
import { pseudonymise } from '@/lib/auth/tokens';
import { redactPII } from '@/lib/serialize/redact';

export type AuditArea = 'Content' | 'Documents' | 'People' | 'Access' | 'Setup';

/**
 * The only way to write the audit log. Append-only: there is no update helper
 * and no delete helper, and the database rejects both anyway.
 *
 * `before`/`after` are PII-redacted here rather than at the call site, so a new
 * caller cannot leak a mobile number into the log by forgetting.
 */
export async function audit(
  sql: Sql,
  event: {
    actorUserId?: string | null;
    actorLabel?: string | null;
    action: string;
    area: AuditArea;
    targetType?: string | null;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO audit_event
      (actor_user_id, actor_label, action, area, target_type, target_id,
       before, after, ip_hash)
    VALUES (${event.actorUserId ?? null}::uuid, ${event.actorLabel ?? null},
            ${event.action}, ${event.area},
            ${event.targetType ?? null}, ${event.targetId ?? null}::uuid,
            ${event.before === undefined ? null : sql.json(redactPII(event.before) as never)},
            ${event.after === undefined ? null : sql.json(redactPII(event.after) as never)},
            ${event.ip ? pseudonymise(event.ip) : null})`;
}
