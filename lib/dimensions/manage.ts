import type { Sql } from 'postgres';
import { audit } from '@/lib/audit/write';

/**
 * Creating, renaming and archiving the dimension tables.
 *
 * Dimensions are the words a company uses for itself, and every access rule is
 * written in them. Two consequences shape this module:
 *
 *  1. RENAMING IS FREE. Rules store ids, not names, so a rename cannot change
 *     who sees what. The save-state line says "rules followed" because they did.
 *
 *  2. ARCHIVING IS NOT FREE, and this module REFUSES it while anything still
 *     depends on the row. The admin prototype instead drops the id from every
 *     rule that names it — its own copy calls that "N rules widened to every
 *     type". Widening access as a side effect of a delete is precisely the leak
 *     this codebase exists to prevent, and an admin who wants those rules
 *     widened can widen them deliberately. So: refuse, and say exactly what is
 *     in the way. See docs/DECISIONS.md.
 */

export type DimensionKind = 'department' | 'role' | 'employee_type' | 'location';

const TABLE: Record<DimensionKind, string> = {
  department: 'department',
  role: 'role',
  employee_type: 'employee_type',
  location: 'location',
};

/** The employee_profile column that points at each dimension. */
const PROFILE_COLUMN: Record<DimensionKind, string> = {
  department: 'department_id',
  role: 'role_id',
  employee_type: 'employee_type_id',
  location: 'location_id',
};

/** The key inside access_rule.conditions that names each dimension. */
const CONDITION_KEY: Record<DimensionKind, string> = {
  department: 'departmentIds',
  role: 'roleIds',
  employee_type: 'employeeTypeIds',
  location: 'locationIds',
};

const LABEL: Record<DimensionKind, string> = {
  department: 'department',
  role: 'role',
  employee_type: 'employee type',
  location: 'site',
};

export type Failure = { ok: false; error: string };

/** Slugs are derived, never typed by the admin. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(sql: Sql, kind: DimensionKind, name: string): Promise<string> {
  const base = slugify(name) || 'item';
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const rows = await sql`
      SELECT 1 FROM ${sql(TABLE[kind])}
       WHERE slug = ${candidate} AND archived_at IS NULL LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createDimension(
  sql: Sql,
  kind: DimensionKind,
  input: { name: string; departmentId?: string | null; timezone?: string; typeKind?: string },
  actorUserId: string,
): Promise<{ ok: true; id: string; name: string } | Failure> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: `Give the ${LABEL[kind]} a name.` };
  if (name.length > 120) return { ok: false, error: 'That name is too long.' };

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM ${sql(TABLE[kind])}
     WHERE lower(name) = lower(${name}) AND archived_at IS NULL LIMIT 1`;
  if (existing.length > 0) {
    return { ok: false, error: `There is already a ${LABEL[kind]} called ${name}.` };
  }

  const slug = await uniqueSlug(sql, kind, name);

  return sql.begin(async (tx) => {
    let rows: { id: string }[];
    switch (kind) {
      case 'department':
        rows = await tx<{ id: string }[]>`
          INSERT INTO department (name, slug) VALUES (${name}, ${slug}) RETURNING id`;
        break;
      case 'role':
        rows = await tx<{ id: string }[]>`
          INSERT INTO role (name, slug, department_id)
          VALUES (${name}, ${slug}, ${input.departmentId ?? null}::uuid) RETURNING id`;
        break;
      case 'employee_type':
        rows = await tx<{ id: string }[]>`
          INSERT INTO employee_type (name, slug, kind)
          VALUES (${name}, ${slug}, ${input.typeKind ?? 'other'}) RETURNING id`;
        break;
      case 'location':
        rows = await tx<{ id: string }[]>`
          INSERT INTO location (name, slug, timezone)
          VALUES (${name}, ${slug}, ${input.timezone ?? 'UTC'}) RETURNING id`;
        break;
    }
    await audit(tx, {
      actorUserId,
      action: `dimension.create.${kind}`,
      area: 'Setup',
      targetType: kind,
      targetId: rows[0]!.id,
      after: { name },
    });
    return { ok: true as const, id: rows[0]!.id, name };
  });
}

export async function renameDimension(
  sql: Sql,
  kind: DimensionKind,
  id: string,
  newName: string,
  actorUserId: string,
): Promise<{ ok: true; from: string; to: string } | Failure> {
  const name = newName.trim();
  if (!name) return { ok: false, error: `Give the ${LABEL[kind]} a name.` };
  if (name.length > 120) return { ok: false, error: 'That name is too long.' };

  return sql.begin(async (tx) => {
    const rows = await tx<{ name: string }[]>`
      SELECT name FROM ${tx(TABLE[kind])}
       WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE`;
    const current = rows[0];
    if (!current) return { ok: false as const, error: `That ${LABEL[kind]} does not exist.` };

    // The slug is deliberately NOT regenerated: nothing employee-facing depends
    // on it, and churning it would break admin links for no gain.
    await tx`UPDATE ${tx(TABLE[kind])}
                SET name = ${name}, updated_at = now()
              WHERE id = ${id}::uuid`;

    await audit(tx, {
      actorUserId,
      action: `dimension.rename.${kind}`,
      area: 'Setup',
      targetType: kind,
      targetId: id,
      before: { name: current.name },
      after: { name },
    });
    return { ok: true as const, from: current.name, to: name };
  });
}

export type Dependents = { people: number; rules: number; roles: number };

/** What still points at this row. Counted live, never stored. */
export async function dependentsOf(
  sql: Sql,
  kind: DimensionKind,
  id: string,
): Promise<Dependents> {
  const column = PROFILE_COLUMN[kind];
  const key = CONDITION_KEY[kind];

  const peopleRows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM employee_profile
     WHERE ${sql(column)} = ${id}::uuid AND archived_at IS NULL`;

  const ruleRows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM access_rule
     WHERE archived_at IS NULL
       AND jsonb_typeof(conditions -> ${key}) = 'array'
       AND jsonb_exists(conditions -> ${key}, ${id})`;

  let roles = 0;
  if (kind === 'department') {
    const roleRows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM role
       WHERE department_id = ${id}::uuid AND archived_at IS NULL`;
    roles = Number(roleRows[0]?.n ?? 0);
  }

  return {
    people: Number(peopleRows[0]?.n ?? 0),
    rules: Number(ruleRows[0]?.n ?? 0),
    roles,
  };
}

export async function archiveDimension(
  sql: Sql,
  kind: DimensionKind,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; name: string; message: string } | Failure> {
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM ${sql(TABLE[kind])}
     WHERE id = ${id}::uuid AND archived_at IS NULL`;
  const row = rows[0];
  if (!row) return { ok: false, error: `That ${LABEL[kind]} is already removed.` };

  const deps = await dependentsOf(sql, kind, id);

  // Refuse rather than silently reassign or widen. Each message names the
  // obstacle and what removing it would otherwise have changed.
  if (deps.people > 0) {
    const who = deps.people === 1 ? 'One person is' : `${deps.people} people are`;
    return {
      ok: false,
      error: `${who} still recorded as ${row.name}. Move them first — this platform will not reassign somebody's ${LABEL[kind]} on your behalf.`,
    };
  }
  if (deps.roles > 0) {
    return {
      ok: false,
      error: `${row.name} still holds ${deps.roles} ${deps.roles === 1 ? 'role' : 'roles'}. Move or remove those first, so nothing is left orphaned.`,
    };
  }
  if (deps.rules > 0) {
    const n = deps.rules === 1 ? '1 rule names' : `${deps.rules} rules name`;
    return {
      ok: false,
      error: `${n} ${row.name}. Removing it here would widen those rules to everyone, and that is a change to who sees what — edit the rules first, deliberately.`,
    };
  }

  return sql.begin(async (tx) => {
    await tx`UPDATE ${tx(TABLE[kind])}
                SET archived_at = now(), updated_at = now()
              WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: `dimension.archive.${kind}`,
      area: 'Setup',
      targetType: kind,
      targetId: id,
      before: { name: row.name },
    });
    return {
      ok: true as const,
      name: row.name,
      // Says what is true now, not what was destroyed — and it is recoverable.
      message: `${row.name} removed — nothing referenced it, and it is in the archive if you want it back.`,
    };
  });
}

export async function restoreDimension(
  sql: Sql,
  kind: DimensionKind,
  id: string,
  actorUserId: string,
): Promise<{ ok: true; name: string } | Failure> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ name: string; slug: string }[]>`
      SELECT name, slug FROM ${tx(TABLE[kind])}
       WHERE id = ${id}::uuid AND archived_at IS NOT NULL FOR UPDATE`;
    const row = rows[0];
    if (!row) return { ok: false as const, error: `That ${LABEL[kind]} is not in the archive.` };

    // A live row may have taken the slug while this one was archived.
    const clash = await tx<{ id: string }[]>`
      SELECT id FROM ${tx(TABLE[kind])}
       WHERE slug = ${row.slug} AND archived_at IS NULL LIMIT 1`;
    const slug = clash.length > 0 ? `${row.slug}-${Date.now().toString(36)}` : row.slug;

    await tx`UPDATE ${tx(TABLE[kind])}
                SET archived_at = NULL, slug = ${slug}, updated_at = now()
              WHERE id = ${id}::uuid`;
    await audit(tx, {
      actorUserId,
      action: `dimension.restore.${kind}`,
      area: 'Setup',
      targetType: kind,
      targetId: id,
      after: { name: row.name },
    });
    return { ok: true as const, name: row.name };
  });
}
