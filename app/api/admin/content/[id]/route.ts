import { z } from 'zod';
import { sql } from '@/lib/db/client';
import { apiAdmin } from '@/lib/auth/api-guard';
import { reorderNode, updateNode, updateNodeInput } from '@/lib/content/manage';
import { archiveNode, restoreNode, purgeNode } from '@/lib/content/archive';
import { publishNode, unpublishNode } from '@/lib/content/state';
import { json, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

const actionInput = z.object({
  action: z.enum(['publish', 'unpublish', 'restore', 'purge', 'move-up', 'move-down']),
});

/** Verb-ish actions that are not plain field edits. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const parsed = actionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That action was not understood.');

  const db = sql();
  const actor = guard.session.userId;

  switch (parsed.data.action) {
    case 'publish': {
      const r = await publishNode(db, id, actor);
      return r.ok
        ? json({ ok: true, message: `Published as version ${r.versionNo}. It reaches whoever your rules allow — and nobody else.` })
        : problem(409, r.error);
    }
    case 'unpublish': {
      const r = await unpublishNode(db, id, actor);
      return r.ok
        ? json({ ok: true, message: 'Back to draft. The published versions are kept; nothing was destroyed.' })
        : problem(409, r.error);
    }
    case 'restore': {
      const r = await restoreNode(db, id, actor);
      return r.ok
        ? json({ ok: true, message: `${r.title} restored as a draft — publish it again when you are ready.` })
        : problem(409, r.error);
    }
    case 'purge': {
      const r = await purgeNode(db, id, actor);
      return r.ok
        ? json({ ok: true, message: `${r.title} deleted for good.` })
        : problem(409, r.error);
    }
    case 'move-up':
    case 'move-down': {
      const r = await reorderNode(db, id, parsed.data.action === 'move-up' ? 'up' : 'down', actor);
      return r.ok ? json(r) : problem(409, r.error);
    }
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const parsed = updateNodeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, 'That was not understood.');

  const result = await updateNode(sql(), id, parsed.data, guard.session.userId);
  return result.ok ? json(result) : problem(409, result.error);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await apiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  if (!isUuid(id)) return problem(404, 'Not found.');

  const result = await archiveNode(sql(), id, guard.session.userId);
  return result.ok
    ? json({ ok: true, message: `${result.title} moved to the archive — restore is one click, and nothing beneath it was destroyed.` })
    : problem(409, result.error);
}
