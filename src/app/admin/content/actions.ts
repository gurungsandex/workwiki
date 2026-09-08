'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { blocks, pages } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import {
  archive,
  ContentError,
  createPage,
  createSection,
  createTopic,
  publishBlock,
  publishContainer,
  publishPage,
  restore,
  unpublish,
  upsertBlock,
} from '@/lib/content/mutations';
import { appendAudit } from '@/lib/audit';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

async function guard(form: FormData) {
  const admin = await requireAdmin();
  await assertCsrf(field(form, CSRF_FIELD));
  return admin;
}

function fail(error: unknown): FormState {
  if (error instanceof ContentError) return { error: error.message };
  return { error: 'That could not be verified or saved. Reload the page and try again.' };
}

export async function addSection(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const title = field(form, 'title');
    if (!title) return { error: 'Give the section a title.' };
    await createSection({ title, lead: field(form, 'lead') || null, actorUserId: admin.id });
    revalidatePath('/admin/content');
    return { notice: `“${title}” created — a draft, invisible to employees until you publish it.` };
  } catch (error) {
    return fail(error);
  }
}

export async function addTopic(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const title = field(form, 'title');
    const sectionId = field(form, 'sectionId');
    if (!title || !sectionId) return { error: 'Pick a section and give the topic a title.' };
    await createTopic({ sectionId, title, lead: field(form, 'lead') || null, actorUserId: admin.id });
    revalidatePath('/admin/content');
    return { notice: `“${title}” created inside its section.` };
  } catch (error) {
    return fail(error);
  }
}

export async function addPage(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const title = field(form, 'title');
    const topicId = field(form, 'topicId');
    if (!title || !topicId) return { error: 'Pick a topic and give the page a title.' };
    const kind = field(form, 'kind') === 'statutory_posting' ? 'statutory_posting' : 'page';
    await createPage({
      topicId,
      title,
      teaser: field(form, 'teaser') || null,
      kind,
      requiresAcknowledgment: field(form, 'requiresAcknowledgment') === 'on',
      actorUserId: admin.id,
    });
    revalidatePath('/admin/content');
    return {
      notice:
        kind === 'statutory_posting'
          ? `“${title}” created as a required posting — this platform will never summarise it; you confirm the source instead.`
          : `“${title}” created — a draft, not visible to anyone yet.`,
    };
  } catch (error) {
    return fail(error);
  }
}

/** Blocks are typed forms, not a blob of HTML. One kind per form. */
export async function addBlock(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const pageId = field(form, 'pageId');
    const kind = field(form, 'kind');
    if (!pageId || !kind) return { error: 'Pick a page and a block type.' };

    let data: unknown;
    if (kind === 'summary') {
      const text = field(form, 'text');
      if (!text) return { error: 'A summary with no words in it is not a summary. Write the two or three sentences.' };
      data = { text, label: field(form, 'label') || undefined };
    } else if (kind === 'key_points') {
      data = { points: field(form, 'points').split('\n').map((line) => line.trim()).filter(Boolean) };
    } else if (kind === 'rich_text') {
      const paragraphs = field(form, 'body')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
      if (paragraphs.length === 0) return { error: 'Nothing to save yet.' };
      data = {
        doc: {
          type: 'doc',
          content: paragraphs.map((paragraph) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: paragraph }],
          })),
        },
      };
    } else if (kind === 'callout') {
      data = { tone: field(form, 'tone') === 'attention' ? 'attention' : 'note', text: field(form, 'text') };
    } else if (kind === 'steps') {
      const steps = field(form, 'steps')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({ text, external: false }));
      const handoffLabel = field(form, 'handoffLabel');
      const handoffHref = field(form, 'handoffHref');
      data = {
        steps,
        handoff: handoffLabel
          ? { kind: handoffHref ? 'external' : 'internal', label: handoffLabel, ...(handoffHref ? { href: handoffHref } : {}) }
          : null,
      };
    } else if (kind === 'external_link') {
      data = { href: field(form, 'href'), title: field(form, 'title'), lastVerifiedAt: new Date().toISOString() };
    } else {
      return { error: `“${kind}” is not a block type you can add from here yet.` };
    }

    const summarySource = kind === 'summary' ? field(form, 'sourceUrl') || null : null;
    await upsertBlock({ pageId, kind, data, sourceUrl: summarySource, actorUserId: admin.id });

    await appendAudit({
      actorUserId: admin.id,
      action: 'block.create',
      area: 'Content',
      targetType: 'page',
      targetId: pageId,
      summary: `A ${kind.replace('_', ' ')} block was added.`,
    });

    revalidatePath('/admin/content');
    return {
      notice:
        kind === 'summary'
          ? 'Summary saved as a draft. It stays invisible to employees until you publish it, and publishing stamps your name on it.'
          : 'Block saved.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function publishBlockAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    await publishBlock({ blockId: field(form, 'blockId'), actorUserId: admin.id });
    revalidatePath('/admin/content');
    return { notice: 'Published — employees now see it, with your name against it.' };
  } catch (error) {
    return fail(error);
  }
}

export async function publishPageAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const result = await publishPage({ pageId: field(form, 'pageId'), actorUserId: admin.id });
    revalidatePath('/admin/content');
    return {
      notice: result.unchanged
        ? 'Nothing changed since the last version, so no new version was made.'
        : `Published as version ${result.version!.versionNo}. Anyone who acknowledged the previous version is asked again.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function publishContainerAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const kind = field(form, 'kind') === 'topic' ? 'topic' : 'section';
    await publishContainer(kind, field(form, 'id'), admin.id);
    revalidatePath('/admin/content');
    return { notice: 'Published — the published pages inside it can now resolve.' };
  } catch (error) {
    return fail(error);
  }
}

export async function unpublishAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const kind = field(form, 'kind') as 'section' | 'topic' | 'page';
    await unpublish(kind, field(form, 'id'), admin.id);
    revalidatePath('/admin/content');
    return { notice: 'Back to a draft. It no longer resolves for employees, and nothing was deleted.' };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const kind = field(form, 'kind') as 'section' | 'topic' | 'page';
    await archive(kind, field(form, 'id'), admin.id);
    revalidatePath('/admin/content');
    revalidatePath('/admin/trash');
    return { notice: 'Moved to the archive. Anything it gated is now decided by whatever sits above it.' };
  } catch (error) {
    return fail(error);
  }
}

export async function restoreAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const kind = field(form, 'kind') as 'section' | 'topic' | 'page';
    await restore(kind, field(form, 'id'), admin.id);
    revalidatePath('/admin/content');
    revalidatePath('/admin/trash');
    return { notice: 'Restored as a draft — publish it when it is ready.' };
  } catch (error) {
    return fail(error);
  }
}

/** Archive a block. Blocks are soft-deleted like everything else. */
export async function archiveBlockAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await guard(form);
    const blockId = field(form, 'blockId');
    const [row] = await db
      .update(blocks)
      .set({ archivedAt: new Date() })
      .where(and(eq(blocks.id, blockId), isNull(blocks.archivedAt)))
      .returning({ pageId: blocks.pageId, kind: blocks.kind });
    if (!row) return { error: 'That block is already in the archive.' };
    const [page] = await db.select({ title: pages.title }).from(pages).where(eq(pages.id, row.pageId)).limit(1);
    await appendAudit({
      actorUserId: admin.id,
      action: 'block.archive',
      area: 'Content',
      targetType: 'block',
      targetId: blockId,
      summary: `A ${row.kind.replace('_', ' ')} block moved out of “${page?.title ?? 'a page'}”. Publish the page again to change what employees see.`,
    });
    revalidatePath('/admin/content');
    return { notice: 'Out of the page. Publish the page again to change what employees see.' };
  } catch (error) {
    return fail(error);
  }
}
