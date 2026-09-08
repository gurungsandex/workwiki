/**
 * Leak tests are first-class, not incidental.
 *
 * Everything here asks the same question from a different direction: can an
 * employee reach a body they are not entitled to — by reading, by searching,
 * by acknowledging, or by the page simply not being published yet?
 *
 * Runs against a real Postgres with migrations applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

process.env.APP_BASE_URL ??= 'http://localhost:3000';
process.env.SESSION_SECRET ??= 'test-secret-that-is-long-enough-for-the-schema-1234';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost:5432/x'));
const suite = hasDb ? describe : describe.skip;

const tag = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

suite('an employee cannot reach what they are not entitled to', () => {
  let db: typeof import('@/db/client')['db'];
  let ids: Record<string, string> = {};
  let subjectFactory: typeof import('@/lib/subject');

  beforeAll(async () => {
    ({ db } = await import('@/db/client'));
    subjectFactory = await import('@/lib/subject');

    const {
      blocks,
      departments,
      employeeProfiles,
      employeeTypes,
      instance,
      locations,
      pages,
      sections,
      tenureAnchors,
      topics,
      users,
    } = await import('@/db/schema');
    const { publishPage } = await import('@/lib/content/mutations');

    await db.insert(instance).values({ id: 1, displayName: 'Test', timeZone: 'America/New_York' }).onConflictDoNothing();

    const [dept] = await db.insert(departments).values({ name: `${tag} dept`, slug: `${tag}-dept` }).returning();
    const [type] = await db.insert(employeeTypes).values({ name: `${tag} type`, slug: `${tag}-type` }).returning();
    const [otherType] = await db.insert(employeeTypes).values({ name: `${tag} other`, slug: `${tag}-other` }).returning();
    const [site] = await db
      .insert(locations)
      .values({ name: `${tag} site`, slug: `${tag}-site`, timeZone: 'America/New_York' })
      .returning();

    const [user] = await db.insert(users).values({ email: `${tag}@example.test`, status: 'active' }).returning();
    await db.insert(employeeProfiles).values({
      userId: user!.id,
      displayName: 'Test person',
      departmentId: dept!.id,
      employeeTypeId: type!.id,
      locationId: site!.id,
      hireDate: new Date().toISOString().slice(0, 10),
      hoursPerWeek: '40',
    });
    await db
      .insert(tenureAnchors)
      .values({ userId: user!.id, key: 'hire_date', date: new Date().toISOString().slice(0, 10) });

    const [section] = await db
      .insert(sections)
      .values({ title: `${tag} section`, slug: `${tag}-section`, sortKey: 'a', state: 'published' })
      .returning();
    const [topic] = await db
      .insert(topics)
      .values({ sectionId: section!.id, title: `${tag} topic`, slug: `${tag}-topic`, sortKey: 'a', state: 'published' })
      .returning();

    const make = async (name: string, state: 'draft' | 'published') => {
      const [page] = await db
        .insert(pages)
        .values({
          topicId: topic!.id,
          title: `${tag} ${name} sasquatch`,
          slug: `${tag}-${name}`,
          teaser: 'One line only.',
          sortKey: 'a',
          state,
          requiresAcknowledgment: true,
        })
        .returning();
      await db.insert(blocks).values({
        pageId: page!.id,
        kind: 'key_points',
        sortKey: 'a',
        data: { points: [`the secret body of the ${name} page, sasquatch`] },
      });
      return page!.id;
    };

    ids = {
      userId: user!.id,
      typeId: type!.id,
      otherTypeId: otherType!.id,
      sectionId: section!.id,
      topicId: topic!.id,
      open: await make('open', 'published'),
      locked: await make('locked', 'published'),
      denied: await make('denied', 'published'),
      draft: await make('draft', 'draft'),
    };

    for (const key of ['open', 'locked', 'denied'] as const) {
      await publishPage({ pageId: ids[key]!, actorUserId: user!.id });
    }

    const { accessRules } = await import('@/db/schema');
    // Locked: everything matches except tenure.
    await db.insert(accessRules).values({
      targetType: 'page',
      targetId: ids.locked!,
      effect: 'allow',
      conditions: { employeeType: [type!.id], tenure: { anchor: 'hire_date', unit: 'year', value: 5 } },
      visibilityWhenLocked: 'teaser',
    });
    // Denied: an ordinary miss on a non-tenure clause.
    await db.insert(accessRules).values({
      targetType: 'page',
      targetId: ids.denied!,
      effect: 'allow',
      conditions: { employeeType: [otherType!.id] },
    });
  }, 60_000);

  afterAll(async () => {
    await db.execute(sql`DELETE FROM access_rule WHERE target_id IN (
      SELECT id FROM page WHERE slug LIKE ${`${tag}%`})`);
    await db.execute(sql`DELETE FROM page WHERE slug LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM topic WHERE slug LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM section WHERE slug LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM "user" WHERE email LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM department WHERE slug LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM employee_type WHERE slug LIKE ${`${tag}%`}`);
    await db.execute(sql`DELETE FROM location WHERE slug LIKE ${`${tag}%`}`);
    const { getPool } = await import('@/db/client');
    await getPool().end();
  });

  const subject = async () => (await subjectFactory.loadSubject(ids.userId!))!;

  it('reads an open page in full', async () => {
    const { loadPage } = await import('@/lib/content/read');
    const read = await loadPage(`${tag}-open`, await subject());
    expect(read?.state).toBe('full');
    expect(JSON.stringify(read?.blocks)).toContain('secret body of the open page');
  });

  it('sends no body at all for a locked page — only the title, date and teaser', async () => {
    const { loadPage } = await import('@/lib/content/read');
    const read = await loadPage(`${tag}-locked`, await subject());
    expect(read?.state).toBe('locked');
    expect(read?.blocks).toEqual([]);
    expect(JSON.stringify(read)).not.toContain('secret body');
    expect(read?.decision.unlockAt).toBeInstanceOf(Date);
  });

  it('404s a denied page exactly as it 404s a page that does not exist', async () => {
    const { loadPage } = await import('@/lib/content/read');
    expect(await loadPage(`${tag}-denied`, await subject())).toBeNull();
    expect(await loadPage(`${tag}-does-not-exist`, await subject())).toBeNull();
  });

  it('404s a draft page — unpublished is not routable', async () => {
    const { loadPage } = await import('@/lib/content/read');
    expect(await loadPage(`${tag}-draft`, await subject())).toBeNull();
  });

  it('keeps locked, denied and draft pages out of search results', async () => {
    const { search } = await import('@/lib/search');
    const { hits } = await search('sasquatch', await subject(), { log: false });
    const slugs = hits.map((hit) => hit.slug);
    expect(slugs).toContain(`${tag}-open`);
    expect(slugs).not.toContain(`${tag}-locked`);
    expect(slugs).not.toContain(`${tag}-denied`);
    expect(slugs).not.toContain(`${tag}-draft`);
    expect(JSON.stringify(hits)).not.toContain('secret body of the locked page');
  });

  it('shows a locked page in navigation as a teaser, and a denied one not at all', async () => {
    const { loadNavigation } = await import('@/lib/content/read');
    const nav = await loadNavigation(await subject());
    const pages = nav.flatMap((s) => s.topics.flatMap((t) => t.pages));
    const locked = pages.find((p) => p.slug === `${tag}-locked`);
    expect(locked?.decision.allowed).toBe(false);
    expect(locked?.decision.visibility).toBe('teaser');
    expect(pages.find((p) => p.slug === `${tag}-denied`)).toBeUndefined();
    expect(pages.find((p) => p.slug === `${tag}-draft`)).toBeUndefined();
  });

  it('does not list a locked page as outstanding — it has not reached them yet', async () => {
    const { outstandingFor } = await import('@/lib/acknowledgments');
    const outstanding = await outstandingFor(await subject());
    const slugs = outstanding.map((item) => item.slug);
    expect(slugs).toContain(`${tag}-open`);
    expect(slugs).not.toContain(`${tag}-locked`);
    expect(slugs).not.toContain(`${tag}-denied`);
  });

  it('hands back real Dates from raw SQL, not the driver’s strings', async () => {
    // Drizzle's typed queries map timestamps; db.execute does not. A string
    // here reaches a component as `.toLocaleDateString is not a function`,
    // which takes the whole page down.
    const { outstandingFor, historyFor } = await import('@/lib/acknowledgments');
    const { failedSearches } = await import('@/lib/health');
    for (const item of await outstandingFor(await subject())) {
      expect(item.publishedAt, item.slug).toBeInstanceOf(Date);
      expect(Number.isNaN(item.publishedAt.getTime())).toBe(false);
    }
    for (const item of await historyFor(ids.userId!)) {
      expect(item.acknowledgedAt).toBeInstanceOf(Date);
    }
    for (const item of await failedSearches()) {
      expect(item.lastAt).toBeInstanceOf(Date);
    }
  });

  it('refuses an acknowledgment whose content hash is not the version’s', async () => {
    const { acknowledge, AcknowledgmentError } = await import('@/lib/acknowledgments');
    const { latestVersion } = await import('@/lib/content/read');
    const version = await latestVersion(ids.open!);
    await expect(
      acknowledge({ subject: await subject(), pageVersionId: version!.id, contentHash: 'not-the-hash' }),
    ).rejects.toBeInstanceOf(AcknowledgmentError);
  });

  it('refuses an acknowledgment of a page the person cannot read', async () => {
    const { acknowledge, AcknowledgmentError } = await import('@/lib/acknowledgments');
    const { latestVersion } = await import('@/lib/content/read');
    const version = await latestVersion(ids.denied!);
    await expect(
      acknowledge({ subject: await subject(), pageVersionId: version!.id, contentHash: version!.contentHash }),
    ).rejects.toBeInstanceOf(AcknowledgmentError);
  });

  it('records one acknowledgment, and asks again after a new version is published', async () => {
    const { acknowledge, outstandingFor } = await import('@/lib/acknowledgments');
    const { latestVersion } = await import('@/lib/content/read');
    const { upsertBlock, publishPage } = await import('@/lib/content/mutations');

    const first = await latestVersion(ids.open!);
    expect((await acknowledge({ subject: await subject(), pageVersionId: first!.id, contentHash: first!.contentHash })).alreadySigned).toBe(false);
    expect((await acknowledge({ subject: await subject(), pageVersionId: first!.id, contentHash: first!.contentHash })).alreadySigned).toBe(true);
    expect((await outstandingFor(await subject())).map((i) => i.slug)).not.toContain(`${tag}-open`);

    await upsertBlock({ pageId: ids.open!, kind: 'callout', data: { tone: 'note', text: 'A material change.' }, actorUserId: ids.userId! });
    const republished = await publishPage({ pageId: ids.open!, actorUserId: ids.userId! });
    expect(republished.unchanged).toBe(false);

    const second = await latestVersion(ids.open!);
    expect(second!.versionNo).toBe(first!.versionNo + 1);
    expect((await outstandingFor(await subject())).map((i) => i.slug)).toContain(`${tag}-open`);
  }, 30_000);

  const refusal = async (statement: string): Promise<string> => {
    const { getPool } = await import('@/db/client');
    try {
      await getPool().query(statement);
      return 'the database allowed it';
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('refuses to update an audit row, at the database', async () => {
    expect(await refusal("UPDATE audit_event SET summary = 'tampered' WHERE true")).toMatch(/append-only/);
  });

  it('refuses to delete an audit row, at the database', async () => {
    expect(await refusal('DELETE FROM audit_event WHERE true')).toMatch(/append-only/);
  });

  it('refuses to truncate the audit log', async () => {
    expect(await refusal('TRUNCATE audit_event')).toMatch(/append-only/);
  });

  it('lets a user be purged without rewriting the audit rows they caused', async () => {
    const { users } = await import('@/db/schema');
    const [ghost] = await db.insert(users).values({ email: `${tag}-ghost@example.test`, status: 'active' }).returning();
    const { appendAudit } = await import('@/lib/audit');
    await appendAudit({ actorUserId: ghost!.id, action: 'test.purge-survives', area: 'People', summary: 'A row that must outlive its actor.' });
    expect(await refusal(`DELETE FROM \"user\" WHERE id = '${ghost!.id}'`)).toBe('the database allowed it');
    const rows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM audit_event WHERE actor_user_id = ${ghost!.id}`,
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it('archives and restores rather than deleting', async () => {
    const { archive, restore } = await import('@/lib/content/mutations');
    const { loadPage } = await import('@/lib/content/read');

    await archive('page', ids.open!, ids.userId!);
    expect(await loadPage(`${tag}-open`, await subject())).toBeNull();

    await restore('page', ids.open!, ids.userId!);
    // Restore brings it back as a draft — publishing again is a deliberate act.
    expect(await loadPage(`${tag}-open`, await subject())).toBeNull();
    const { publishPage } = await import('@/lib/content/mutations');
    await publishPage({ pageId: ids.open!, actorUserId: ids.userId! });
    expect((await loadPage(`${tag}-open`, await subject()))?.state).toBe('full');
  }, 30_000);

  it('refuses to purge something that has not been archived first', async () => {
    const { purge, ContentError } = await import('@/lib/content/mutations');
    await expect(purge('page', ids.open!, ids.userId!)).rejects.toBeInstanceOf(ContentError);
  });
});
