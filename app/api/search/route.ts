import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { search, logSearch } from '@/lib/search/query';
import { resolveContactsForNode } from '@/lib/contacts/resolve';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Search. Logs every query INCLUDING the ones that found nothing — that list is
 * the content-gap list and the highest-signal thing in the product.
 *
 * A zero-result search is never a dead end: it comes back with the person whose
 * job it is to answer, resolved from this reader's department and site.
 */
export async function GET(request: Request) {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;
  const { subject, session } = guard.viewer;

  const q = new URL(request.url).searchParams.get('q') ?? '';
  const db = sql();
  const hits = await search(db, subject, q);

  if (q.trim().length >= 2) {
    await logSearch(db, session.userId, q, hits.length);
  }

  if (hits.length === 0 && q.trim().length >= 2) {
    const contacts = await resolveContactsForNode(db, null, subject, {
      isAdmin: session.isAdmin,
      isManager: false,
    });
    return json({
      hits: [],
      askInstead: contacts[0] ?? null,
      note: 'Your question is logged for whoever maintains this handbook, so the next person searching it finds a page.',
    });
  }

  return json({ hits });
}
