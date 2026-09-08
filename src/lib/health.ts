import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { toDate } from '@/lib/rows';

/**
 * Content health, derived from real state at read time. Nothing here is stored,
 * and every check names what to do rather than scoring the instance.
 */

export interface HealthCheck {
  key: string;
  label: string;
  count: number;
  detail: string;
}

export async function contentHealth(): Promise<HealthCheck[]> {
  const rows = await db.execute<{
    pages_with_no_rule: number;
    pages_with_no_contact: number;
    stale_drafts: number;
    unpublished_summaries: number;
    guides_without_handoff: number;
    contacts_without_owner: number;
    postings_unconfirmed: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM page p
        JOIN topic t ON t.id = p.topic_id
        JOIN section s ON s.id = t.section_id
        WHERE p.state = 'published' AND p.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM access_rule r WHERE r.archived_at IS NULL
                          AND ((r.target_type = 'page' AND r.target_id = p.id)
                            OR (r.target_type = 'topic' AND r.target_id = t.id)
                            OR (r.target_type = 'section' AND r.target_id = s.id)))
      ) AS pages_with_no_rule,
      (SELECT count(*)::int FROM page p
        JOIN topic t ON t.id = p.topic_id
        JOIN section s ON s.id = t.section_id
        WHERE p.state = 'published' AND p.archived_at IS NULL
          AND p.help_contact_card_id IS NULL AND t.help_contact_card_id IS NULL AND s.help_contact_card_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM contact_binding b WHERE b.target_type = 'instance')
      ) AS pages_with_no_contact,
      (SELECT count(*)::int FROM page WHERE state = 'draft' AND archived_at IS NULL
        AND updated_at < now() - interval '30 days') AS stale_drafts,
      (SELECT count(*)::int FROM block WHERE kind = 'summary' AND published_at IS NULL AND archived_at IS NULL)
        AS unpublished_summaries,
      (SELECT count(*)::int FROM block WHERE kind = 'steps' AND archived_at IS NULL
        AND (data -> 'handoff') IS NULL) AS guides_without_handoff,
      (SELECT count(*)::int FROM contact_card WHERE archived_at IS NULL
        AND (person_name IS NULL OR btrim(person_name) = '')) AS contacts_without_owner,
      (SELECT count(*)::int FROM block b JOIN page p ON p.id = b.page_id
        WHERE p.kind = 'statutory_posting' AND b.archived_at IS NULL AND b.published_at IS NULL)
        AS postings_unconfirmed
  `);

  const row = rows.rows[0]!;

  return [
    {
      key: 'no-rule',
      label: 'Published pages with no rule anywhere above them',
      count: row.pages_with_no_rule,
      detail: 'These reach everybody. That may be right — it should be a decision, not an oversight.',
    },
    {
      key: 'no-contact',
      label: 'Published pages that resolve to nobody',
      count: row.pages_with_no_contact,
      detail: 'An employee who cannot follow the page has nowhere to go. Set an instance-wide fallback card.',
    },
    {
      key: 'stale-drafts',
      label: 'Drafts untouched for a month',
      count: row.stale_drafts,
      detail: 'Invisible to employees, and probably forgotten. Publish them or archive them.',
    },
    {
      key: 'unpublished-summaries',
      label: 'Summaries written but not published',
      count: row.unpublished_summaries,
      detail: 'Employees see the page without them. Publishing stamps your name on the words.',
    },
    {
      key: 'no-handoff',
      label: 'Guides that stop without a handoff',
      count: row.guides_without_handoff,
      detail: 'A guide that ends mid-air leaves people thinking they filed something they did not.',
    },
    {
      key: 'no-owner',
      label: 'Contact cards with no named person',
      count: row.contacts_without_owner,
      detail: 'A function with no name behind it is where questions go to die.',
    },
    {
      key: 'postings-unconfirmed',
      label: 'Required postings with no confirmed source',
      count: row.postings_unconfirmed,
      detail: 'This platform never summarises a required posting. Until you confirm the source, employees see nothing.',
    },
  ];
}

export interface FailedSearch {
  query: string;
  times: number;
  who: string;
  lastAt: Date;
}

/** The highest-signal list in the product: what people looked for and did not find. */
export async function failedSearches(limit = 40): Promise<FailedSearch[]> {
  const rows = await db.execute<{ query: string; times: number; who: string; last_at: string | Date }>(sql`
    SELECT e.query,
           count(*)::int AS times,
           coalesce(string_agg(DISTINCT d.name, ', '), 'across the company') AS who,
           max(e.created_at) AS last_at
    FROM search_event e
    LEFT JOIN department d ON d.id = e.department_id
    WHERE e.result_count = 0
    GROUP BY e.query
    ORDER BY times DESC, last_at DESC
    LIMIT ${limit}
  `);
  return rows.rows.map((r) => ({ query: r.query, times: r.times, who: r.who, lastAt: toDate(r.last_at) }));
}
