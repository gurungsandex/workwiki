import type { Sql } from 'postgres';
import { z } from 'zod';
import { audit } from '@/lib/audit/write';

/**
 * Contact cards.
 *
 * A card is stored ONCE and embedded by reference everywhere, so a changed
 * number changes everywhere. Bindings attach a card to a node, a department or
 * a site; the resolution chain in lib/contacts/resolve.ts walks them.
 *
 * `field_visibility` is per field (`all` | `managers` | `admins`) and is applied
 * in the resolver — the single place contact responses are built — so no route
 * can leak a mobile number by forgetting a filter.
 */

export const fieldVisibility = z
  .object({
    email: z.enum(['all', 'managers', 'admins']).optional(),
    phone: z.enum(['all', 'managers', 'admins']).optional(),
    extension: z.enum(['all', 'managers', 'admins']).optional(),
  })
  .strict();

export const contactInput = z.object({
  name: z.string().min(1).max(160),
  title: z.string().max(160).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  extension: z.string().max(20).nullable().optional(),
  about: z.string().max(600).nullable().optional(),
  responseTimeNote: z.string().max(200).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  isDefaultHr: z.boolean().optional(),
  fieldVisibility: fieldVisibility.optional(),
});

export type ContactInput = z.infer<typeof contactInput>;

type Failure = { ok: false; error: string };

const nullish = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export async function createContact(
  sql: Sql,
  input: ContactInput,
  actorUserId: string,
): Promise<{ ok: true; id: string; message: string } | Failure> {
  return sql.begin(async (tx) => {
    // Only one card can be the default; claiming it releases the previous one
    // rather than failing on the partial unique index.
    if (input.isDefaultHr) {
      await tx`UPDATE contact_card SET is_default_hr = false
                WHERE is_default_hr AND archived_at IS NULL`;
    }
    const rows = await tx<{ id: string }[]>`
      INSERT INTO contact_card
        (name, title, email, phone, extension, about, response_time_note,
         department_id, location_id, is_default_hr, field_visibility)
      VALUES (${input.name.trim()}, ${nullish(input.title)}, ${nullish(input.email)},
              ${nullish(input.phone)}, ${nullish(input.extension)}, ${nullish(input.about)},
              ${nullish(input.responseTimeNote)},
              ${nullish(input.departmentId)}::uuid, ${nullish(input.locationId)}::uuid,
              ${input.isDefaultHr ?? false},
              ${tx.json((input.fieldVisibility ?? {}) as never)})
      RETURNING id`;

    await audit(tx, {
      actorUserId,
      action: 'contact.create',
      area: 'People',
      targetType: 'contact_card',
      targetId: rows[0]!.id,
      after: { name: input.name },
    });
    return {
      ok: true as const,
      id: rows[0]!.id,
      message: input.isDefaultHr
        ? `${input.name} saved — they are now the fallback on any page with nobody else named.`
        : `${input.name} saved — attach them to a section or a department to make them resolve.`,
    };
  });
}

export async function updateContact(
  sql: Sql,
  id: string,
  input: ContactInput,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ name: string }[]>`
      SELECT name FROM contact_card
       WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE`;
    if (!rows[0]) return { ok: false as const, error: 'That contact does not exist.' };

    if (input.isDefaultHr) {
      await tx`UPDATE contact_card SET is_default_hr = false
                WHERE is_default_hr AND archived_at IS NULL AND id <> ${id}::uuid`;
    }

    await tx`
      UPDATE contact_card SET
        name = ${input.name.trim()},
        title = ${nullish(input.title)},
        email = ${nullish(input.email)},
        phone = ${nullish(input.phone)},
        extension = ${nullish(input.extension)},
        about = ${nullish(input.about)},
        response_time_note = ${nullish(input.responseTimeNote)},
        department_id = ${nullish(input.departmentId)}::uuid,
        location_id = ${nullish(input.locationId)}::uuid,
        is_default_hr = ${input.isDefaultHr ?? false},
        field_visibility = ${tx.json((input.fieldVisibility ?? {}) as never)},
        updated_at = now()
      WHERE id = ${id}::uuid`;

    await audit(tx, {
      actorUserId,
      action: 'contact.update',
      area: 'People',
      targetType: 'contact_card',
      targetId: id,
      before: { name: rows[0].name },
      after: { name: input.name },
    });
    // Says what is true now, because the card is embedded by reference.
    return {
      ok: true as const,
      message: `${input.name} saved — every page that names them shows the new details.`,
    };
  });
}

export async function archiveContact(
  sql: Sql,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM contact_card WHERE id = ${id}::uuid AND archived_at IS NULL`;
  if (!rows[0]) return { ok: false, error: 'That contact is already removed.' };

  const bound = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM contact_binding
     WHERE card_id = ${id}::uuid AND archived_at IS NULL`;
  const n = Number(bound[0]?.n ?? 0);

  return sql.begin(async (tx) => {
    await tx`UPDATE contact_card SET archived_at = now(), is_default_hr = false,
                    updated_at = now()
              WHERE id = ${id}::uuid`;
    await tx`UPDATE contact_binding SET archived_at = now()
              WHERE card_id = ${id}::uuid AND archived_at IS NULL`;
    await audit(tx, {
      actorUserId,
      action: 'contact.archive',
      area: 'People',
      targetType: 'contact_card',
      targetId: id,
      before: { name: rows[0]!.name },
    });
    return {
      ok: true as const,
      // Says what moved, not what was destroyed.
      message:
        n === 0
          ? `${rows[0]!.name} removed — nothing pointed at them.`
          : `${rows[0]!.name} removed — ${n === 1 ? '1 page falls' : `${n} pages fall`} back to the next contact up the chain.`,
    };
  });
}

export async function bindContact(
  sql: Sql,
  input: { cardId: string; targetType: 'node' | 'department' | 'location'; targetId: string; purpose: string },
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const card = await tx<{ name: string }[]>`
      SELECT name FROM contact_card WHERE id = ${input.cardId}::uuid AND archived_at IS NULL`;
    if (!card[0]) return { ok: false as const, error: 'That contact does not exist.' };

    await tx`
      INSERT INTO contact_binding (card_id, target_type, target_id, purpose)
      VALUES (${input.cardId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
              ${input.purpose.trim() || 'Who to ask'})
      ON CONFLICT (card_id, target_type, target_id, purpose)
      DO UPDATE SET archived_at = NULL`;

    await audit(tx, {
      actorUserId,
      action: 'contact.bind',
      area: 'People',
      targetType: 'contact_card',
      targetId: input.cardId,
      after: { targetType: input.targetType, targetId: input.targetId },
    });
    return {
      ok: true as const,
      message: `${card[0]!.name} now resolves there, and anywhere beneath it with nobody closer named.`,
    };
  });
}

export async function unbindContact(
  sql: Sql,
  bindingId: string,
  actorUserId: string,
): Promise<{ ok: true; message: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ card_id: string; name: string }[]>`
      SELECT b.card_id, c.name FROM contact_binding b
        JOIN contact_card c ON c.id = b.card_id
       WHERE b.id = ${bindingId}::uuid AND b.archived_at IS NULL`;
    if (!rows[0]) return { ok: false as const, error: 'That attachment is already gone.' };

    await tx`UPDATE contact_binding SET archived_at = now() WHERE id = ${bindingId}::uuid`;
    await audit(tx, {
      actorUserId,
      action: 'contact.unbind',
      area: 'People',
      targetType: 'contact_card',
      targetId: rows[0]!.card_id,
    });
    return {
      ok: true as const,
      message: `${rows[0]!.name} taken off there — those pages fall back to the next contact up the chain.`,
    };
  });
}
