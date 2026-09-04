import { sql } from '@/lib/db/client';
import { apiViewer } from '@/lib/auth/api-guard';
import { readTree } from '@/lib/content/read';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Access-filtered navigation with lock states and unlock dates. */
export async function GET() {
  const guard = await apiViewer();
  if (!guard.ok) return guard.response;
  return json({ tree: await readTree(sql(), guard.viewer.subject) });
}
