import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { nodeAccessCte } from '@/lib/access/compile';
import { parsePlainDate } from '@/lib/access/tenure';
import type { RuleConditions, Subject } from '@/lib/access/types';

/** Same evaluation instant as tests/access/evaluate.test.ts. */
const MARCH_1 = new Date('2026-03-01T12:00:00Z');

/**
 * The same five truth-table rows as evaluate.test.ts, asserted through the SQL
 * predicate. The random agreement test proves the two implementations match;
 * this proves they match the SPEC, not merely each other.
 */

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const SEC = 'aaaa0000-0000-0000-0000-000000000001';
const TOP = 'aaaa0000-0000-0000-0000-000000000002';
const PAGE = 'aaaa0000-0000-0000-0000-000000000003';
const NJ = 'cccc0000-0000-0000-0000-00000000000a';
const NY = 'cccc0000-0000-0000-0000-00000000000b';
const FT = 'dddd0000-0000-0000-0000-00000000000a';

function subject(over: Partial<Subject> = {}): Subject {
  return {
    userId: 'u',
    departmentId: null,
    roleId: null,
    employeeTypeId: FT,
    locationId: NJ,
    groupIds: [],
    hoursPerWeek: 40,
    anchors: { hire_date: parsePlainDate('2026-01-15') },
    timezone: 'America/New_York',
    ...over,
  };
}

run('SQL predicate against the spec truth table', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(URL!, { max: 1 });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM access_rule`;
    await sql`DELETE FROM content_node`;
    await sql`INSERT INTO content_node (id, level, title, slug, sort_key)
              VALUES (${SEC}::uuid, 'section', 'S', 's', 'm')`;
    await sql`INSERT INTO content_node (id, level, parent_id, title, slug, sort_key)
              VALUES (${TOP}::uuid, 'topic', ${SEC}::uuid, 'T', 't', 'm')`;
    await sql`INSERT INTO content_node (id, level, parent_id, title, slug, sort_key)
              VALUES (${PAGE}::uuid, 'page', ${TOP}::uuid, 'P', 'p', 'm')`;
  });

  const addRule = async (
    target: string,
    effect: 'allow' | 'deny',
    conditions: RuleConditions,
    locked: 'hidden' | 'teaser' = 'teaser',
  ) => {
    await sql`INSERT INTO access_rule
                (target_type, target_id, effect, conditions, visibility_when_locked)
              VALUES ('node', ${target}::uuid, ${effect},
                      ${sql.json(conditions as never)}, ${locked})`;
  };

  const decide = async (s: Subject, node = PAGE) => {
    const cte = nodeAccessCte(sql, s, MARCH_1);
    const rows = await sql<
      { allowed: boolean; visibility: string; unlock_at: Date | null }[]
    >`${cte} SELECT allowed, visibility, unlock_at FROM node_access
        WHERE node_id = ${node}::uuid`;
    return rows[0]!;
  };

  it('row 1 — no rule on the page inherits its section', async () => {
    await addRule(SEC, 'allow', { locationIds: [NJ] });
    expect(await decide(subject())).toMatchObject({ allowed: true, visibility: 'full' });
    expect(await decide(subject({ locationId: NY }))).toMatchObject({
      allowed: false,
      visibility: 'hidden',
    });
  });

  it('row 2 — two allows are an OR', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(PAGE, 'allow', { locationIds: [NY] });
    await addRule(PAGE, 'allow', { locationIds: [NJ] });
    expect(await decide(subject())).toMatchObject({ allowed: true });
  });

  it('row 3 — an explicit deny beats every allow, at any level', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(TOP, 'deny', { locationIds: [NJ] });
    await addRule(PAGE, 'allow', {});
    expect(await decide(subject())).toMatchObject({
      allowed: false,
      visibility: 'hidden',
    });
  });

  it('row 4 — everything but tenure is LOCKED with a teaser and a date', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(PAGE, 'allow', {
      employeeTypeIds: [FT],
      tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
    });
    const d = await decide(subject());
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('teaser');
    expect(d.unlock_at!.toISOString()).toBe('2026-04-15T04:00:00.000Z');
  });

  it('row 4b — a rule may choose to hide rather than tease while locked', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(
      PAGE,
      'allow',
      { tenure: { anchor: 'hire_date', unit: 'day', value: 90 } },
      'hidden',
    );
    const d = await decide(subject());
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.unlock_at).not.toBeNull();
  });

  it('row 4c — failing a non-tenure condition is hidden with no date', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(PAGE, 'allow', {
      locationIds: [NY],
      tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
    });
    const d = await decide(subject());
    expect(d.allowed).toBe(false);
    expect(d.visibility).toBe('hidden');
    expect(d.unlock_at).toBeNull();
  });

  it('row 4d — first_of_next_month composes after the offset', async () => {
    await addRule(SEC, 'allow', {});
    await addRule(PAGE, 'allow', {
      tenure: {
        anchor: 'hire_date',
        unit: 'month',
        value: 12,
        then: 'first_of_next_month',
      },
    });
    const d = await decide(subject());
    // 2026-01-15 + 12 months = 2027-01-15, then first of next month = 2027-02-01.
    expect(d.unlock_at!.toISOString()).toBe('2027-02-01T05:00:00.000Z');
  });

  it('row 5 — a parent narrower than the child: the parent wins', async () => {
    await addRule(SEC, 'allow', { locationIds: [NJ] });
    await addRule(PAGE, 'allow', {});
    expect(await decide(subject({ locationId: NY }))).toMatchObject({
      allowed: false,
      visibility: 'hidden',
    });
  });

  it('nothing is public by default: no rules anywhere means hidden', async () => {
    expect(await decide(subject())).toMatchObject({
      allowed: false,
      visibility: 'hidden',
    });
  });
});
