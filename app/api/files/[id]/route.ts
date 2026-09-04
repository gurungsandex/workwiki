import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { signedGetUrl } from '@/lib/files/store';
import { evaluate } from '@/lib/access/evaluate';
import { resolveChain } from '@/lib/access/resolve-chain';
import { problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The only way to read a file.
 *
 * Files are never public. This checks the access rules on every node the file
 * is attached to and redirects to a short-lived signed URL only if at least one
 * of them is readable by this subject. A file attached to nothing is admin-only.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;
  const { subject, session } = guard.viewer;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(404, 'Not found.');

  const db = sql();
  const [file] = await db<{ storage_key: string; mime_type: string }[]>`
    SELECT storage_key, mime_type FROM file_object
     WHERE id = ${id}::uuid AND archived_at IS NULL`;
  if (!file) return problem(404, 'Not found.');

  const attachments = await db<{ node_id: string }[]>`
    SELECT node_id FROM node_file
     WHERE file_object_id = ${id}::uuid AND archived_at IS NULL
    UNION
    SELECT node_id FROM block
     WHERE source_file_id = ${id}::uuid AND archived_at IS NULL`;

  let permitted = session.isAdmin;
  if (!permitted) {
    const at = new Date();
    for (const a of attachments) {
      const chain = await resolveChain(db, a.node_id);
      // Only a FULL decision releases a file. A tenure-locked page's
      // attachment is part of the body and stays withheld.
      if (evaluate(subject, chain, at).allowed) {
        permitted = true;
        break;
      }
    }
  }

  // Indistinguishable from a file that does not exist.
  if (!permitted) return problem(404, 'Not found.');

  const url = await signedGetUrl(file.storage_key, 60);
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'no-store, private' },
  });
}
