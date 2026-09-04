import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { evaluate } from '@/lib/access/evaluate';
import { nodeAccessCte } from '@/lib/access/compile';
import { formatPlainDate, parsePlainDate } from '@/lib/access/tenure';
import type {
  AccessRule,
  RuleChain,
  RuleConditions,
  Subject,
  TenureUnit,
} from '@/lib/access/types';

/**
 * The leak test.
 *
 * Generates random rule trees and subjects, evaluates each one with the pure
 * function AND with the SQL predicate against a real Postgres, and fails on any
 * disagreement. A divergence here is a content leak in search or export.
 */

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

/* --- deterministic PRNG so a failure is reproducible from the seed --- */
let seed = 0x5eed1234;
function rnd(): number {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 0xffffffff;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;

const DEPTS = ['11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002'];
const ROLES = ['22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002'];
const TYPES = ['33333333-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002'];
const LOCS  = ['44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002'];
const GROUPS = ['g-a', 'g-b'];
const UNITS: TenureUnit[] = ['day', 'week', 'month', 'year'];
const TZ = 'America/New_York';
const EVAL_INSTANTS = [
  '2020-06-01T12:00:00Z', '2025-06-01T12:00:00Z', '2026-03-01T12:00:00Z',
  '2026-09-04T12:00:00Z', '2027-02-01T04:59:59Z', '2027-02-01T05:00:00Z',
  '2030-01-01T00:00:00Z',
];

function randomConditions(): RuleConditions {
  const c: RuleConditions = {};
  // A quarter of rules are unconditional, so a node frequently carries BOTH a
  // matching allow and a matching deny — the case that proves deny wins.
  if (chance(0.25)) return c;
  if (chance(0.45)) c.departmentIds = chance(0.1) ? 'any' : [pick(DEPTS)];
  if (chance(0.3))  c.roleIds = chance(0.1) ? 'any' : [pick(ROLES)];
  if (chance(0.5))  c.employeeTypeIds = chance(0.1) ? 'any' : [pick(TYPES)];
  if (chance(0.45)) c.locationIds = chance(0.1) ? 'any' : [pick(LOCS), pick(LOCS)];
  if (chance(0.2))  c.groupIds = [pick(GROUPS)];
  if (chance(0.25)) c.hoursPerWeek = { op: pick(['gte', 'lte', 'gt', 'lt'] as const), value: pick([10, 20, 30, 40]) };
  if (chance(0.5)) {
    c.tenure = {
      anchor: chance(0.9) ? 'hire_date' : 'transfer_date',
      unit: pick(UNITS),
      value: pick([0, 30, 60, 90, 1, 2, 12]),
      ...(chance(0.3) ? { then: 'first_of_next_month' as const } : {}),
    };
  }
  return c;
}

function randomRule(id: string): AccessRule {
  return {
    id,
    effect: chance(0.3) ? 'deny' : 'allow',
    conditions: randomConditions(),
    visibilityWhenLocked: chance(0.25) ? 'hidden' : 'teaser',
    priority: 0,
  };
}

function randomSubject(): Subject {
  return {
    userId: 'u',
    departmentId: chance(0.9) ? pick(DEPTS) : null,
    roleId: chance(0.9) ? pick(ROLES) : null,
    employeeTypeId: chance(0.9) ? pick(TYPES) : null,
    locationId: chance(0.9) ? pick(LOCS) : null,
    groupIds: chance(0.4) ? [pick(GROUPS)] : [],
    hoursPerWeek: chance(0.85) ? pick([12, 20, 24, 35, 40]) : null,
    anchors: { hire_date: parsePlainDate(pick(['2020-03-31', '2025-01-15', '2026-01-31', '2026-08-01'])) },
    timezone: TZ,
  };
}

run('SQL predicate agrees with the pure evaluator', () => {
  let sql: postgres.Sql;
  const uuid = (n: number) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    sql = postgres(URL!, { max: 1 });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('agrees on 300 generated rule trees', async () => {
    const CASES = 500;
    const disagreements: string[] = [];

    for (let i = 0; i < CASES; i++) {
      // Build a section -> topic -> page chain with random rules at each level.
      const ids = [uuid(i * 3 + 1), uuid(i * 3 + 2), uuid(i * 3 + 3)];
      const levels = ['section', 'topic', 'page'] as const;
      const rulesPerLevel = levels.map((_, li) =>
        Array.from({ length: Math.floor(rnd() * 3) }, (_, ri) =>
          randomRule(`r${i}-${li}-${ri}`),
        ),
      );

      await sql`DELETE FROM access_rule`;
      await sql`DELETE FROM content_node`;

      for (let li = 0; li < 3; li++) {
        await sql`
          INSERT INTO content_node (id, level, parent_id, title, slug, sort_key)
          VALUES (${ids[li]!}::uuid, ${levels[li]!},
                  ${li === 0 ? null : ids[li - 1]!}::uuid,
                  ${'N' + li}, ${'n' + li}, 'm')`;
        for (const r of rulesPerLevel[li]!) {
          await sql`
            INSERT INTO access_rule
              (target_type, target_id, effect, conditions, visibility_when_locked, priority)
            VALUES ('node', ${ids[li]!}::uuid, ${r.effect},
                    ${sql.json(r.conditions as never)}, ${r.visibilityWhenLocked!}, 0)`;
        }
      }

      const subject = randomSubject();
      const chain: RuleChain = levels.map((level, li) => ({
        id: ids[li]!,
        level,
        rules: rulesPerLevel[li]!,
      }));

      // One explicit instant for both sides — and it varies across cases so
      // both "already unlocked" and "still locked" states are exercised.
      const now = new Date(pick(EVAL_INSTANTS));
      const cte = nodeAccessCte(sql, subject, now);
      const rows = await sql<
        { node_id: string; allowed: boolean; visibility: string; unlock_at: Date | null }[]
      >`${cte} SELECT node_id, allowed, visibility, unlock_at FROM node_access
          WHERE node_id = ${ids[2]!}::uuid`;

      const fromSql = rows[0];
      const fromFn = evaluate(subject, chain, now);

      if (!fromSql) {
        disagreements.push(`case ${i}: SQL returned no row for the leaf`);
        continue;
      }

      const sqlUnlock = fromSql.unlock_at ? fromSql.unlock_at.toISOString() : null;
      const fnUnlock = fromFn.unlockAt ? fromFn.unlockAt.toISOString() : null;

      if (
        fromSql.allowed !== fromFn.allowed ||
        fromSql.visibility !== fromFn.visibility ||
        sqlUnlock !== fnUnlock
      ) {
        disagreements.push(
          `case ${i}\n` +
            `  subject: ${JSON.stringify({ ...subject, anchors: Object.fromEntries(Object.entries(subject.anchors).map(([k, v]) => [k, formatPlainDate(v)])) })}\n` +
            `  rules:   ${JSON.stringify(rulesPerLevel)}\n` +
            `  sql:     allowed=${fromSql.allowed} vis=${fromSql.visibility} unlock=${sqlUnlock}\n` +
            `  fn:      allowed=${fromFn.allowed} vis=${fromFn.visibility} unlock=${fnUnlock}`,
        );
      }
    }

    expect(disagreements.slice(0, 3).join('\n\n')).toBe('');
    expect(disagreements).toHaveLength(0);
  }, 240_000);
});
