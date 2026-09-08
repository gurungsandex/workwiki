import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { searchEvents } from '@/db/schema';
import { pageReadableSql, tenureSatisfiedRuleIds } from '@/lib/access/sql';
import type { Subject } from '@/lib/access/types';

/**
 * Search is the primary navigation, so it is also the highest-risk read path:
 * the access filter compiles into the query rather than dropping rows after
 * the fact. Ranking is ts_rank_cd; typo tolerance is trigram similarity.
 *
 * A zero-result search is not a dead end and not a silent one: the query is
 * logged, and it becomes the content-gap list the admin reads each week.
 */

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  teaser: string | null;
  sectionTitle: string;
  topicTitle: string;
  /** Where the answer comes from, for the grouped result list. */
  origin: 'company';
  snippet: string;
  rank: number;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Logged for the admin's failed-search list when nothing matched. */
  loggedAsGap: boolean;
}

export async function search(
  query: string,
  subject: Subject,
  options: { limit?: number; at?: Date; log?: boolean } = {},
): Promise<SearchOutcome> {
  const trimmed = query.trim().slice(0, 200);
  const at = options.at ?? new Date();
  const limit = Math.min(options.limit ?? 25, 50);

  if (trimmed.length === 0) return { hits: [], loggedAsGap: false };

  const ruleRows = await db.execute<{ id: string; conditions: Record<string, unknown> }>(
    sql`SELECT id, conditions FROM access_rule WHERE archived_at IS NULL`,
  );
  const tenureOk = tenureSatisfiedRuleIds(
    ruleRows.rows.map((r) => ({ id: r.id, conditions: r.conditions as never })),
    subject,
    at,
  );

  const predicate = pageReadableSql(subject, tenureOk, {
    sectionId: sql`s.id`,
    topicId: sql`t.id`,
    pageId: sql`p.id`,
  });

  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    teaser: string | null;
    section_title: string;
    topic_title: string;
    snippet: string;
    rank: number;
  }>(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${trimmed}) AS tsq)
    SELECT
      p.id, p.slug, p.title, p.teaser,
      s.title AS section_title,
      t.title AS topic_title,
      ts_headline(
        'english',
        left(coalesce(p.teaser, '') || ' ' || coalesce(p.search_text, ''), 4000),
        (SELECT tsq FROM q),
        'MaxFragments=1,MaxWords=28,MinWords=12,StartSel=<<,StopSel=>>'
      ) AS snippet,
      GREATEST(
        ts_rank_cd(
          to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.teaser,'') || ' ' || coalesce(p.search_text,'')),
          (SELECT tsq FROM q)
        ),
        similarity(p.title, ${trimmed}) * 0.6
      )::float8 AS rank
    FROM page p
    JOIN topic t ON t.id = p.topic_id
    JOIN section s ON s.id = t.section_id
    WHERE p.state = 'published' AND p.archived_at IS NULL
      AND t.state = 'published' AND t.archived_at IS NULL
      AND s.state = 'published' AND s.archived_at IS NULL
      AND (
        to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.teaser,'') || ' ' || coalesce(p.search_text,''))
          @@ (SELECT tsq FROM q)
        OR similarity(p.title, ${trimmed}) > 0.28
      )
      AND ${predicate}
    ORDER BY rank DESC, p.title ASC
    LIMIT ${limit}
  `);

  const hits: SearchHit[] = rows.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    teaser: r.teaser,
    sectionTitle: r.section_title,
    topicTitle: r.topic_title,
    origin: 'company',
    snippet: r.snippet,
    rank: r.rank,
  }));

  if (options.log !== false) {
    await db.insert(searchEvents).values({
      userId: subject.userId,
      query: trimmed,
      resultCount: hits.length,
      departmentId: subject.departmentId,
      roleId: subject.roleId,
      locationId: subject.locationId,
      employeeTypeId: subject.employeeTypeId,
    });
  }

  return { hits, loggedAsGap: hits.length === 0 };
}
