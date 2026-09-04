import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { readPage } from '@/lib/content/read';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;

  const { slug } = await context.params;
  const page = await readPage(sql(), guard.viewer.subject, slug);

  // Hidden and unpublished are both 404: an employee cannot probe for titles.
  if (page.kind === 'not-found') return problem(404, 'Not found.');
  return json(page);
}
