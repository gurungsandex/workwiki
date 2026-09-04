import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { readPage, readTree } from '@/lib/content/read';
import { search } from '@/lib/search/query';
import { acknowledge } from '@/lib/content/acknowledge';
import { parsePlainDate } from '@/lib/access/tenure';
import { contentHash } from '@/lib/content/canonical';
import type { RuleConditions, Subject } from '@/lib/access/types';

/**
 * Leak tests are first-class, not incidental (spec §13).
 *
 * The secret string below is planted in the body of a gated page. Every read
 * surface an employee can reach is then asserted, byte-wise, not to contain it.
 * If any of these fail, content is leaking.
 */

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const SECRET = 'CANARY-a7f3c91e-the-body-of-a-gated-page';
const SEC = 'bbbb0000-0000-0000-0000-000000000001';
const TOP = 'bbbb0000-0000-0000-0000-000000000002';
const PAGE = 'bbbb0000-0000-0000-0000-000000000003';
const NJ = 'cccc0000-0000-0000-0000-00000000000a';
const NY = 'cccc0000-0000-0000-0000-00000000000b';
const AT = new Date('2026-03-01T12:00:00Z');

function subject(over: Partial<Subject> = {}): Subject {
  return {
    userId: '99999999-9999-9999-9999-999999999999',
    departmentId: null,
    roleId: null,
    employeeTypeId: null,
    locationId: NJ,
    groupIds: [],
    hoursPerWeek: 40,
    anchors: { hire_date: parsePlainDate('2026-01-15') },
    timezone: 'America/New_York',
    ...over,
  };
}

run('a gated body never reaches an employee', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(URL!, { max: 1 });
    await sql`
      INSERT INTO app_user (id, email, status, is_admin)
      VALUES ('99999999-9999-9999-9999-999999999999', 'canary@example.test', 'active', false)
      ON CONFLICT (email) DO NOTHING`;
  });
  afterAll(async () => {
    await sql`DELETE FROM app_user WHERE email = 'canary@example.test'`;
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM acknowledgment`;
    await sql`DELETE FROM node_search`;
    await sql`DELETE FROM page_version`;
    await sql`DELETE FROM access_rule`;
    await sql`DELETE FROM content_node`;

    await sql`INSERT INTO content_node (id, level, title, slug, sort_key, state)
              VALUES (${SEC}::uuid, 'section', 'Benefits', 'benefits', 'm', 'published')`;
    await sql`INSERT INTO content_node (id, level, parent_id, title, slug, sort_key, state)
              VALUES (${TOP}::uuid, 'topic', ${SEC}::uuid, 'Retirement', 'retirement', 'm', 'published')`;
    await sql`
      INSERT INTO content_node (id, level, parent_id, title, slug, sort_key, state, teaser)
      VALUES (${PAGE}::uuid, 'page', ${TOP}::uuid, 'Retirement plan enrolment',
              'retirement-enrolment', 'm', 'published',
              'How the plan match works and when you can join.')`;

    const snapshot = {
      nodeId: PAGE,
      title: 'Retirement plan enrolment',
      blocks: [{ id: 'b1', kind: 'summary', slot: 'summary', sortKey: 'm', data: { text: SECRET } }],
    };
    await sql`
      INSERT INTO page_version (node_id, version_no, snapshot, content_hash)
      VALUES (${PAGE}::uuid, 1, ${sql.json(snapshot as never)}, ${contentHash(snapshot)})`;
    await sql`
      INSERT INTO node_search (node_id, title, body)
      VALUES (${PAGE}::uuid, 'Retirement plan enrolment', ${SECRET + ' retirement enrolment plan match'})`;

    await sql`INSERT INTO access_rule (target_type, target_id, effect, conditions)
              VALUES ('node', ${SEC}::uuid, 'allow', '{}'::jsonb)`;
    await sql`INSERT INTO access_rule (target_type, target_id, effect, conditions)
              VALUES ('node', ${TOP}::uuid, 'allow', '{}'::jsonb)`;
  });

  const addPageRule = async (effect: 'allow' | 'deny', conditions: RuleConditions) => {
    await sql`INSERT INTO access_rule (target_type, target_id, effect, conditions)
              VALUES ('node', ${PAGE}::uuid, ${effect}, ${sql.json(conditions as never)})`;
  };

  const noSecret = (value: unknown) => {
    expect(JSON.stringify(value)).not.toContain(SECRET);
  };

  describe('when the page is tenure-locked', () => {
    beforeEach(async () => {
      await addPageRule('allow', {
        tenure: { anchor: 'hire_date', unit: 'day', value: 90 },
      });
    });

    it('readPage returns a teaser with no body', async () => {
      const r = await readPage(sql, subject(), 'retirement-enrolment', AT);
      expect(r.kind).toBe('locked');
      noSecret(r);
      if (r.kind === 'locked') {
        // The employee still learns the title and the date. That is the product.
        expect(r.title).toBe('Retirement plan enrolment');
        expect(r.unlockAt).toBe('2026-04-15T04:00:00.000Z');
      }
    });

    it('readTree lists it as locked, with a teaser and no body', async () => {
      const t = await readTree(sql, subject(), AT);
      noSecret(t);
      const page = t.find((i) => i.slug === 'retirement-enrolment');
      expect(page?.locked).toBe(true);
      expect(page?.unlockAt).toBe('2026-04-15T04:00:00.000Z');
    });

    it('search returns the title but never a body snippet', async () => {
      const hits = await search(sql, subject(), 'retirement', { at: AT });
      noSecret(hits);
      expect(hits.some((h) => h.slug === 'retirement-enrolment')).toBe(true);
      expect(hits.find((h) => h.slug === 'retirement-enrolment')?.snippet).toBeNull();
    });

    it('searching for the secret text itself returns no body', async () => {
      const hits = await search(sql, subject(), SECRET, { at: AT });
      noSecret(hits);
    });

    it('acknowledgment of a locked page is refused', async () => {
      const [v] = await sql<{ id: string; content_hash: Buffer }[]>`
        SELECT id, content_hash FROM page_version WHERE node_id = ${PAGE}::uuid`;
      const r = await acknowledge(sql, subject(), {
        pageVersionId: v!.id,
        contentHashHex: v!.content_hash.toString('hex'),
      }, AT);
      expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    });
  });

  describe('when the page is denied outright', () => {
    beforeEach(async () => {
      await addPageRule('allow', {});
      await addPageRule('deny', { locationIds: [NJ] });
    });

    it('readPage is indistinguishable from a page that does not exist', async () => {
      const r = await readPage(sql, subject(), 'retirement-enrolment', AT);
      expect(r.kind).toBe('not-found');
      noSecret(r);
    });

    it('readTree omits it entirely — not present-and-flagged', async () => {
      const t = await readTree(sql, subject(), AT);
      noSecret(t);
      expect(t.some((i) => i.slug === 'retirement-enrolment')).toBe(false);
    });

    it('search never returns it, by title or by body', async () => {
      noSecret(await search(sql, subject(), 'retirement', { at: AT }));
      noSecret(await search(sql, subject(), SECRET, { at: AT }));
      const hits = await search(sql, subject(), 'retirement', { at: AT });
      expect(hits.some((h) => h.slug === 'retirement-enrolment')).toBe(false);
    });
  });

  describe('when the page is not published', () => {
    beforeEach(async () => {
      await addPageRule('allow', {});
      await sql`UPDATE content_node SET state = 'draft' WHERE id = ${PAGE}::uuid`;
    });

    it('is not routable, and looks exactly like a missing page', async () => {
      const r = await readPage(sql, subject(), 'retirement-enrolment', AT);
      expect(r.kind).toBe('not-found');
      noSecret(r);
    });

    it('is absent from the tree and from search', async () => {
      noSecret(await readTree(sql, subject(), AT));
      noSecret(await search(sql, subject(), 'retirement', { at: AT }));
    });
  });

  describe('when the page IS permitted', () => {
    beforeEach(async () => {
      await addPageRule('allow', { locationIds: [NJ] });
    });

    it('the body is delivered to the entitled reader', async () => {
      const r = await readPage(sql, subject(), 'retirement-enrolment', AT);
      expect(r.kind).toBe('full');
      expect(JSON.stringify(r)).toContain(SECRET);
    });

    it('but not to a reader in a different location', async () => {
      const r = await readPage(sql, subject({ locationId: NY }), 'retirement-enrolment', AT);
      expect(r.kind).toBe('not-found');
      noSecret(r);
    });

    it('acknowledgment with a stale hash is rejected', async () => {
      const [v] = await sql<{ id: string }[]>`
        SELECT id FROM page_version WHERE node_id = ${PAGE}::uuid`;
      const r = await acknowledge(sql, subject(), {
        pageVersionId: v!.id,
        contentHashHex: 'de'.repeat(32),
      }, AT);
      expect(r).toMatchObject({ ok: false, code: 'stale' });
    });

    it('acknowledgment with the right hash succeeds and is idempotent', async () => {
      const [v] = await sql<{ id: string; content_hash: Buffer }[]>`
        SELECT id, content_hash FROM page_version WHERE node_id = ${PAGE}::uuid`;
      const input = {
        pageVersionId: v!.id,
        contentHashHex: v!.content_hash.toString('hex'),
      };
      expect(await acknowledge(sql, subject(), input, AT))
        .toMatchObject({ ok: true, alreadyAcknowledged: false });
      expect(await acknowledge(sql, subject(), input, AT))
        .toMatchObject({ ok: true, alreadyAcknowledged: true });
    });
  });

  describe('empty branches are hidden, never rendered empty', () => {
    it('a section whose only page is hidden disappears from the tree', async () => {
      await addPageRule('deny', {});
      const t = await readTree(sql, subject(), AT);
      expect(t.some((i) => i.slug === 'benefits')).toBe(false);
      expect(t.some((i) => i.slug === 'retirement')).toBe(false);
    });
  });
});
