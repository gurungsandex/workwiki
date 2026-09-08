/**
 * The leak test that matters: the SQL predicate and the pure evaluator must
 * agree, on every rule shape, for every subject. They are two implementations
 * of one decision, and search reads the SQL one.
 *
 * Runs against a real Postgres. Set TEST_DATABASE_URL (CI does) or the suite
 * skips rather than passing quietly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { evaluate } from '@/lib/access/engine';
import { pageReadableSql, tenureSatisfiedRuleIds } from '@/lib/access/sql';
import { parseCalendarDate } from '@/lib/access/dates';
import type { AccessRule, Conditions, Node, Subject } from '@/lib/access/types';

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/** A tiny deterministic PRNG so a failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

const DEPTS = ['11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002'];
const TYPES = ['22222222-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002'];
const LOCS = ['33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002'];
const GROUPS = ['44444444-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000002'];

const SECTION_ID = '55555555-0000-4000-8000-000000000001';
const TOPIC_ID = '66666666-0000-4000-8000-000000000001';
const PAGE_ID = '77777777-0000-4000-8000-000000000001';

const AT = new Date('2026-06-01T12:00:00Z');

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function randomConditions(r: () => number): Conditions {
  const c: Conditions = {};
  if (r() < 0.5) c.department = r() < 0.15 ? 'any' : [pick(r, DEPTS)];
  if (r() < 0.5) c.employeeType = r() < 0.15 ? [] : [pick(r, TYPES)];
  if (r() < 0.5) c.location = r() < 0.2 ? LOCS : [pick(r, LOCS)];
  if (r() < 0.3) c.group = [pick(r, GROUPS)];
  if (r() < 0.3) c.hoursPerWeek = { op: pick(r, ['gte', 'gt', 'lte', 'lt', 'eq'] as const), value: pick(r, [20, 24, 30, 40]) };
  if (r() < 0.4) {
    c.tenure = {
      anchor: r() < 0.85 ? 'hire_date' : 'transfer_date',
      unit: pick(r, ['day', 'month', 'year'] as const),
      value: pick(r, [30, 60, 90, 1, 6, 12]),
      ...(r() < 0.3 ? { then: 'first_of_next_month' as const } : {}),
    };
  }
  return c;
}

function randomSubject(r: () => number, i: number): Subject {
  return {
    userId: `u${i}`,
    departmentId: r() < 0.1 ? null : pick(r, DEPTS),
    roleId: null,
    employeeTypeId: r() < 0.1 ? null : pick(r, TYPES),
    locationId: r() < 0.1 ? null : pick(r, LOCS),
    anchors: {
      hire_date: parseCalendarDate(pick(r, ['2020-03-31', '2026-01-15', '2026-05-20', '2026-04-01', '2026-06-01'])),
      ...(r() < 0.5 ? { transfer_date: parseCalendarDate('2026-02-28') } : {}),
    },
    groupIds: r() < 0.4 ? [pick(r, GROUPS)] : [],
    hoursPerWeek: r() < 0.15 ? null : pick(r, [16, 20, 24, 32, 40]),
    timeZone: pick(r, ['America/New_York', 'America/Los_Angeles', 'UTC']),
  };
}

suite('the SQL predicate agrees with the evaluator', () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool);
    await db.execute(sql`
      CREATE TEMP TABLE access_rule (
        id uuid PRIMARY KEY,
        target_type text NOT NULL,
        target_id uuid NOT NULL,
        effect text NOT NULL,
        conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        visibility_when_locked text NOT NULL DEFAULT 'teaser',
        priority integer NOT NULL DEFAULT 0,
        archived_at timestamptz
      ) ON COMMIT PRESERVE ROWS
    `);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('agrees on 400 randomly generated rule sets', async () => {
    const r = rng(20260601);
    const disagreements: string[] = [];

    for (let iteration = 0; iteration < 400; iteration++) {
      const rules: { rule: AccessRule; target: 'section' | 'topic' | 'page' }[] = [];
      const count = Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        rules.push({
          rule: {
            id: `88888888-0000-4000-8000-${String(iteration * 10 + i).padStart(12, '0')}`,
            effect: r() < 0.25 ? 'deny' : 'allow',
            conditions: randomConditions(r),
            visibilityWhenLocked: 'teaser',
            priority: 0,
          },
          target: pick(r, ['section', 'topic', 'page'] as const),
        });
      }

      await db.execute(sql`DELETE FROM access_rule`);
      for (const { rule, target } of rules) {
        const targetId = target === 'section' ? SECTION_ID : target === 'topic' ? TOPIC_ID : PAGE_ID;
        await db.execute(sql`
          INSERT INTO access_rule (id, target_type, target_id, effect, conditions)
          VALUES (${rule.id}, ${target}, ${targetId}, ${rule.effect}, ${JSON.stringify(rule.conditions)}::jsonb)
        `);
      }

      const chain: Node[] = (['section', 'topic', 'page'] as const).map((type) => ({
        id: type === 'section' ? SECTION_ID : type === 'topic' ? TOPIC_ID : PAGE_ID,
        type,
        rules: rules.filter((x) => x.target === type).map((x) => x.rule),
      }));

      const subject = randomSubject(r, iteration);
      const expected = evaluate(subject, chain, AT).allowed;

      const tenureOk = tenureSatisfiedRuleIds(
        rules.map(({ rule }) => ({ id: rule.id, conditions: rule.conditions })),
        subject,
        AT,
      );
      const predicate = pageReadableSql(subject, tenureOk, {
        sectionId: sql`${SECTION_ID}::uuid`,
        topicId: sql`${TOPIC_ID}::uuid`,
        pageId: sql`${PAGE_ID}::uuid`,
      });
      const rows = await db.execute<{ readable: boolean }>(sql`SELECT ${predicate} AS readable`);
      const actual = (rows.rows[0] as { readable: boolean }).readable;

      if (actual !== expected) {
        disagreements.push(
          `iteration ${iteration}: engine=${expected} sql=${actual}\n` +
            `  subject: ${JSON.stringify(subject)}\n` +
            `  rules:   ${JSON.stringify(rules)}`,
        );
      }
    }

    expect(disagreements.join('\n\n')).toBe('');
  }, 120_000);

  it('agrees that a locked page is not a search hit', async () => {
    await db.execute(sql`DELETE FROM access_rule`);
    const ruleId = '99999999-0000-4000-8000-000000000001';
    await db.execute(sql`
      INSERT INTO access_rule (id, target_type, target_id, effect, conditions)
      VALUES (${ruleId}, 'page', ${PAGE_ID}, 'allow',
              '{"tenure":{"anchor":"hire_date","unit":"year","value":5}}'::jsonb)
    `);
    const subject = randomSubject(rng(1), 0);
    subject.anchors = { hire_date: parseCalendarDate('2026-01-15') };

    const chain: Node[] = [
      { id: SECTION_ID, type: 'section', rules: [] },
      { id: TOPIC_ID, type: 'topic', rules: [] },
      {
        id: PAGE_ID,
        type: 'page',
        rules: [
          {
            id: ruleId,
            effect: 'allow',
            conditions: { tenure: { anchor: 'hire_date', unit: 'year', value: 5 } },
            visibilityWhenLocked: 'teaser',
            priority: 0,
          },
        ],
      },
    ];

    const decision = evaluate(subject, chain, AT);
    expect(decision.allowed).toBe(false);
    expect(decision.visibility).toBe('teaser');

    const tenureOk = tenureSatisfiedRuleIds(
      [{ id: ruleId, conditions: { tenure: { anchor: 'hire_date', unit: 'year', value: 5 } } }],
      subject,
      AT,
    );
    const rows = await db.execute<{ readable: boolean }>(
      sql`SELECT ${pageReadableSql(subject, tenureOk, {
        sectionId: sql`${SECTION_ID}::uuid`,
        topicId: sql`${TOPIC_ID}::uuid`,
        pageId: sql`${PAGE_ID}::uuid`,
      })} AS readable`,
    );
    expect((rows.rows[0] as { readable: boolean }).readable).toBe(false);
  });
});
