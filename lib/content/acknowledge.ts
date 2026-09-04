import type { Sql } from 'postgres';
import { evaluate } from '@/lib/access/evaluate';
import { resolveChain } from '@/lib/access/resolve-chain';
import type { Subject } from '@/lib/access/types';
import { pseudonymise } from '@/lib/auth/tokens';

/**
 * Acknowledgment.
 *
 * Attests a SPECIFIC version. The client posts back the content hash it
 * rendered; a mismatch means the page changed under the reader and is rejected
 * rather than silently attested. Re-acknowledgment after a new publish is a new
 * row against a new version, never an update.
 */

export type AckResult =
  | { ok: true; alreadyAcknowledged: boolean }
  | { ok: false; error: string; code: 'not-found' | 'stale' | 'forbidden' };

export async function acknowledge(
  sql: Sql,
  subject: Subject,
  input: { pageVersionId: string; contentHashHex: string; ip?: string | null },
  at: Date = new Date(),
): Promise<AckResult> {
  const [version] = await sql<
    { id: string; node_id: string; content_hash: Buffer }[]
  >`SELECT id, node_id, content_hash FROM page_version WHERE id = ${input.pageVersionId}::uuid`;

  if (!version) {
    return { ok: false, error: 'That version does not exist.', code: 'not-found' };
  }

  // An employee cannot acknowledge something they cannot read.
  const chain = await resolveChain(sql, version.node_id);
  const decision = evaluate(subject, chain, at);
  if (!decision.allowed) {
    return {
      ok: false,
      error: 'That page is not available to you.',
      code: 'forbidden',
    };
  }

  if (version.content_hash.toString('hex') !== input.contentHashHex.toLowerCase()) {
    return {
      ok: false,
      code: 'stale',
      error:
        'This page changed while you were reading it. Reload and read it again before acknowledging — an acknowledgment has to name the version you actually read.',
    };
  }

  const inserted = await sql<{ id: string }[]>`
    INSERT INTO acknowledgment (user_id, page_version_id, ip_hash)
    VALUES (${subject.userId}::uuid, ${version.id}::uuid,
            ${input.ip ? pseudonymise(input.ip) : null})
    ON CONFLICT (user_id, page_version_id) DO NOTHING
    RETURNING id`;

  return { ok: true, alreadyAcknowledged: inserted.length === 0 };
}

/**
 * What still needs this person's acknowledgment: published versions of pages
 * they can see, that they have not attested. Computed, never stored.
 */
export async function outstandingAcknowledgments(
  sql: Sql,
  subject: Subject,
  at: Date = new Date(),
) {
  const { nodeAccessCte } = await import('@/lib/access/compile');
  const cte = nodeAccessCte(sql, subject, at);
  return sql<
    { node_id: string; title: string; slug: string; version_id: string; version_no: number }[]
  >`
    ${cte}
    SELECT n.id AS node_id, n.title, n.slug, v.id AS version_id, v.version_no
      FROM content_node n
      JOIN node_access a ON a.node_id = n.id
      JOIN LATERAL (
        SELECT id, version_no FROM page_version
         WHERE node_id = n.id ORDER BY version_no DESC LIMIT 1
      ) v ON true
     WHERE n.archived_at IS NULL
       AND n.state = 'published'
       AND a.allowed
       AND n.content_kind_id IN (SELECT id FROM content_kind WHERE slug = 'policy')
       AND NOT EXISTS (
         SELECT 1 FROM acknowledgment ack
          WHERE ack.user_id = ${subject.userId}::uuid AND ack.page_version_id = v.id)
     ORDER BY n.title`;
}
