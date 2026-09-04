import type { Sql } from 'postgres';
import { nodeAccessCte } from '@/lib/access/compile';
import type { Subject } from '@/lib/access/types';

/**
 * Search.
 *
 * The access filter is a JOIN in the same query, not a second pass over
 * results: filtering after ranking would leak the existence and ordering of
 * content the reader may not see, and would make pagination lie.
 *
 * Typo tolerance comes from pg_trgm similarity on the title; ranking from
 * ts_rank_cd over the tsvector.
 */

export type SearchHit = {
  nodeId: string;
  title: string;
  slug: string;
  level: string;
  locked: boolean;
  unlockAt: string | null;
  /** Present only for items the reader may actually open. */
  snippet: string | null;
  rank: number;
};

export async function search(
  sql: Sql,
  subject: Subject,
  rawQuery: string,
  opts: { limit?: number; at?: Date } = {},
): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 200);
  if (q.length < 2) return [];
  const limit = Math.min(opts.limit ?? 25, 50);
  const at = opts.at ?? new Date();
  const cte = nodeAccessCte(sql, subject, at);

  const rows = await sql<
    {
      node_id: string;
      title: string;
      slug: string;
      level: string;
      allowed: boolean;
      unlock_at: Date | null;
      snippet: string | null;
      rank: number;
    }[]
  >`
    ${cte}
    SELECT n.id AS node_id, n.title, n.slug, n.level,
           a.allowed, a.unlock_at,
           CASE WHEN a.allowed
                THEN ts_headline('english', s.body, websearch_to_tsquery('english', ${q}),
                                 'MaxWords=28, MinWords=12, ShortWord=3, MaxFragments=1')
                ELSE NULL END AS snippet,
           (ts_rank_cd(s.document, websearch_to_tsquery('english', ${q}))
             + similarity(s.title, ${q})) AS rank
      FROM node_search s
      JOIN content_node n ON n.id = s.node_id
      JOIN node_access a ON a.node_id = n.id
     WHERE n.archived_at IS NULL
       AND n.state = 'published'
       AND (n.publish_at IS NULL OR n.publish_at <= ${at})
       AND (n.unpublish_at IS NULL OR n.unpublish_at > ${at})
       -- The filter is part of the query, so ranking and paging only ever see
       -- rows this subject is entitled to.
       AND a.visibility <> 'hidden'
       AND (s.document @@ websearch_to_tsquery('english', ${q})
            OR similarity(s.title, ${q}) > 0.25)
     ORDER BY rank DESC, n.title ASC
     LIMIT ${limit}`;

  return rows.map((r) => ({
    nodeId: r.node_id,
    title: r.title,
    slug: r.slug,
    level: r.level,
    locked: !r.allowed,
    unlockAt: r.unlock_at ? r.unlock_at.toISOString() : null,
    // A locked hit never carries a body fragment — the title and date only.
    snippet: r.allowed ? r.snippet : null,
    rank: Number(r.rank),
  }));
}

/** Every search is logged, including the ones that found nothing. */
export async function logSearch(
  sql: Sql,
  userId: string | null,
  query: string,
  resultCount: number,
) {
  await sql`
    INSERT INTO search_event (user_id, query, result_count)
    VALUES (${userId}::uuid, ${query.trim().slice(0, 200)}, ${resultCount})`;
}
