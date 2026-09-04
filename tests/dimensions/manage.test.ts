import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import {
  archiveDimension,
  createDimension,
  dependentsOf,
  renameDimension,
  restoreDimension,
  slugify,
} from '@/lib/dimensions/manage';

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const ACTOR = '77777777-7777-7777-7777-777777777777';

run('dimension management', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(URL!, { max: 1 });
    await sql`
      INSERT INTO app_user (id, email, status, is_admin)
      VALUES (${ACTOR}::uuid, 'dim-admin@example.test', 'active', true)
      ON CONFLICT (email) DO NOTHING`;
    await sql`
      INSERT INTO employee_profile (user_id, display_name)
      VALUES (${ACTOR}::uuid, 'Dimension Admin')
      ON CONFLICT (user_id) DO NOTHING`;
  });

  afterAll(async () => {
    // The actor is deliberately NOT deleted: audit_event references it and is
    // append-only, so a user who has written history cannot be hard-deleted.
    // That is the intended behaviour (people are archived, never purged by
    // accident), so the fixture row is left rather than the constraint evaded.
    await sql`UPDATE employee_profile SET department_id = NULL, role_id = NULL,
                     employee_type_id = NULL, location_id = NULL
               WHERE user_id = ${ACTOR}::uuid`;
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM access_rule`;
    await sql`DELETE FROM employee_profile WHERE user_id <> ${ACTOR}::uuid`;
    await sql`DELETE FROM role`;
    await sql`DELETE FROM department`;
    await sql`DELETE FROM employee_type`;
    await sql`DELETE FROM location`;
  });

  describe('creating', () => {
    it('creates a department and derives a slug', async () => {
      const r = await createDimension(sql, 'department', { name: 'Field Operations' }, ACTOR);
      expect(r.ok).toBe(true);
      const [row] = await sql<{ slug: string }[]>`SELECT slug FROM department`;
      expect(row!.slug).toBe('field-operations');
    });

    it('refuses a duplicate name, case-insensitively', async () => {
      await createDimension(sql, 'department', { name: 'Safety' }, ACTOR);
      const r = await createDimension(sql, 'department', { name: 'safety' }, ACTOR);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toContain('already a department called');
    });

    it('refuses an empty name', async () => {
      expect(await createDimension(sql, 'location', { name: '   ' }, ACTOR))
        .toMatchObject({ ok: false });
    });

    it('accepts a company word this platform has never heard of', async () => {
      // The whole point: no enum, no CHECK, no migration.
      const r = await createDimension(sql, 'role', { name: 'Enum' }, ACTOR);
      expect(r.ok).toBe(true);
    });

    it('gives a second same-slug name a distinct slug', async () => {
      await createDimension(sql, 'location', { name: 'Yard #1' }, ACTOR);
      await createDimension(sql, 'location', { name: 'Yard 1' }, ACTOR);
      const rows = await sql<{ slug: string }[]>`SELECT slug FROM location ORDER BY slug`;
      expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
    });

    it('writes an audit entry', async () => {
      await createDimension(sql, 'department', { name: 'People' }, ACTOR);
      const [e] = await sql<{ action: string }[]>`
        SELECT action FROM audit_event ORDER BY id DESC LIMIT 1`;
      expect(e!.action).toBe('dimension.create.department');
    });
  });

  describe('renaming', () => {
    it('keeps the id, so rules follow automatically', async () => {
      const created = await createDimension(sql, 'employee_type', { name: 'Fulltime' }, ACTOR);
      if (!created.ok) throw new Error('setup failed');

      await sql`
        INSERT INTO content_node (id, level, title, slug, sort_key)
        VALUES ('dddd0000-0000-0000-0000-0000000000ff', 'section', 'S', 's-rename', 'm')`;
      await sql`
        INSERT INTO access_rule (target_type, target_id, effect, conditions)
        VALUES ('node', 'dddd0000-0000-0000-0000-0000000000ff', 'allow',
                ${sql.json({ employeeTypeIds: [created.id] } as never)})`;

      const r = await renameDimension(sql, 'employee_type', created.id, 'Full-time', ACTOR);
      expect(r).toMatchObject({ ok: true, from: 'Fulltime', to: 'Full-time' });

      // The rule still names the same id — nothing about access changed.
      const [rule] = await sql<{ conditions: { employeeTypeIds: string[] } }[]>`
        SELECT conditions FROM access_rule LIMIT 1`;
      expect(rule!.conditions.employeeTypeIds).toEqual([created.id]);

      await sql`DELETE FROM access_rule`;
      await sql`DELETE FROM content_node WHERE slug = 's-rename'`;
    });

    it('refuses to rename something that does not exist', async () => {
      expect(
        await renameDimension(sql, 'role', '00000000-0000-0000-0000-000000000000', 'X', ACTOR),
      ).toMatchObject({ ok: false });
    });
  });

  describe('archiving refuses while anything depends on it', () => {
    it('refuses when a person is still recorded in it', async () => {
      const dept = await createDimension(sql, 'department', { name: 'Payroll' }, ACTOR);
      if (!dept.ok) throw new Error('setup failed');
      await sql`
        UPDATE employee_profile SET department_id = ${dept.id}::uuid
         WHERE user_id = ${ACTOR}::uuid`;

      const r = await archiveDimension(sql, 'department', dept.id, ACTOR);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain('still recorded as Payroll');
        expect(r.error).toContain('will not reassign');
      }
      await sql`UPDATE employee_profile SET department_id = NULL WHERE user_id = ${ACTOR}::uuid`;
    });

    it('refuses a department that still holds roles', async () => {
      const dept = await createDimension(sql, 'department', { name: 'Field' }, ACTOR);
      if (!dept.ok) throw new Error('setup failed');
      await createDimension(sql, 'role', { name: 'Foreman', departmentId: dept.id }, ACTOR);

      const r = await archiveDimension(sql, 'department', dept.id, ACTOR);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('still holds 1 role');
    });

    it('refuses when a rule names it, rather than widening the rule', async () => {
      const loc = await createDimension(sql, 'location', { name: 'Fresno yard' }, ACTOR);
      if (!loc.ok) throw new Error('setup failed');

      await sql`
        INSERT INTO content_node (id, level, title, slug, sort_key)
        VALUES ('dddd0000-0000-0000-0000-0000000000fe', 'section', 'S', 's-arch', 'm')`;
      await sql`
        INSERT INTO access_rule (target_type, target_id, effect, conditions)
        VALUES ('node', 'dddd0000-0000-0000-0000-0000000000fe', 'allow',
                ${sql.json({ locationIds: [loc.id] } as never)})`;

      const r = await archiveDimension(sql, 'location', loc.id, ACTOR);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain('1 rule names Fresno yard');
        expect(r.error).toContain('who sees what');
      }

      // Critically: the rule is untouched. Nothing widened behind the admin.
      const [rule] = await sql<{ conditions: { locationIds: string[] } }[]>`
        SELECT conditions FROM access_rule LIMIT 1`;
      expect(rule!.conditions.locationIds).toEqual([loc.id]);

      await sql`DELETE FROM access_rule`;
      await sql`DELETE FROM content_node WHERE slug = 's-arch'`;
    });
  });

  describe('archiving and restoring when nothing depends on it', () => {
    it('archives softly and restores', async () => {
      const t = await createDimension(sql, 'employee_type', { name: 'Seasonal' }, ACTOR);
      if (!t.ok) throw new Error('setup failed');

      const archived = await archiveDimension(sql, 'employee_type', t.id, ACTOR);
      expect(archived.ok).toBe(true);
      if (archived.ok) expect(archived.message).toContain('in the archive if you want it back');

      // Soft: the row is still there.
      const [row] = await sql<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM employee_type WHERE id = ${t.id}::uuid`;
      expect(row!.archived_at).not.toBeNull();

      const restored = await restoreDimension(sql, 'employee_type', t.id, ACTOR);
      expect(restored).toMatchObject({ ok: true, name: 'Seasonal' });

      const [back] = await sql<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM employee_type WHERE id = ${t.id}::uuid`;
      expect(back!.archived_at).toBeNull();
    });

    it('frees the name for reuse once archived, and survives restoring into the clash', async () => {
      const first = await createDimension(sql, 'location', { name: 'Depot' }, ACTOR);
      if (!first.ok) throw new Error('setup failed');
      await archiveDimension(sql, 'location', first.id, ACTOR);

      const second = await createDimension(sql, 'location', { name: 'Depot' }, ACTOR);
      expect(second.ok).toBe(true);

      // Restoring the original must not collide with the live one's slug.
      const restored = await restoreDimension(sql, 'location', first.id, ACTOR);
      expect(restored.ok).toBe(true);

      const rows = await sql<{ slug: string }[]>`
        SELECT slug FROM location WHERE archived_at IS NULL`;
      expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    });

    it('refuses to archive twice', async () => {
      const t = await createDimension(sql, 'employee_type', { name: 'Casual' }, ACTOR);
      if (!t.ok) throw new Error('setup failed');
      await archiveDimension(sql, 'employee_type', t.id, ACTOR);
      expect(await archiveDimension(sql, 'employee_type', t.id, ACTOR))
        .toMatchObject({ ok: false });
    });
  });

  describe('dependent counting is a live query', () => {
    it('reports zero for a fresh row', async () => {
      const d = await createDimension(sql, 'department', { name: 'New' }, ACTOR);
      if (!d.ok) throw new Error('setup failed');
      expect(await dependentsOf(sql, 'department', d.id))
        .toEqual({ people: 0, rules: 0, roles: 0 });
    });
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Field Operations')).toBe('field-operations');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify('  Yard #1 -- North  ')).toBe('yard-1-north');
  });
  it('returns empty for a name with nothing usable', () => {
    expect(slugify('###')).toBe('');
  });
});
