'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { issueReports, pageFeedback, pages } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { acknowledge, AcknowledgmentError } from '@/lib/acknowledgments';
import { requireReader } from '@/lib/auth/guards';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { clientIp } from '@/lib/auth/session';
import { hashIp } from '@/lib/crypto';
import { applyDelay, consume } from '@/lib/rate-limit';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The body carries the page_version_id and the content hash the client actually
 * rendered. A mismatch is rejected — an attestation against content the person
 * did not see is worse than none.
 */
export async function acknowledgePage(_state: FormState, form: FormData): Promise<FormState> {
  const { subject } = await requireReader();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  try {
    const result = await acknowledge({
      subject,
      pageVersionId: field(form, 'pageVersionId'),
      contentHash: field(form, 'contentHash'),
      ipHash: hashIp(clientIp(await headers())),
    });
    revalidatePath('/home');
    return {
      notice: result.alreadySigned
        ? 'You had already acknowledged this version.'
        : 'Acknowledged — recorded against this exact version, with today’s date.',
    };
  } catch (error) {
    if (error instanceof AcknowledgmentError) return { error: error.message };
    throw error;
  }
}

/** An employee report arrives with its page reference attached. */
export async function reportIssue(_state: FormState, form: FormData): Promise<FormState> {
  const { subject } = await requireReader();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const limit = await consume('feedback:user', subject.userId);
  await applyDelay(limit);
  if (!limit.allowed) return { error: 'That is a lot of reports in one go. Try again a little later.' };

  const body = field(form, 'body');
  const kind = field(form, 'kind') || 'out_of_date';
  const slug = field(form, 'pageSlug');
  if (body.length < 5) return { error: 'Tell us what is wrong — a sentence is enough.' };

  const [page] = slug
    ? await db.select({ id: pages.id }).from(pages).where(and(eq(pages.slug, slug), isNull(pages.archivedAt))).limit(1)
    : [];

  await db.insert(issueReports).values({
    reporterId: subject.userId,
    pageId: page?.id ?? null,
    kind,
    body: body.slice(0, 4000),
  });

  return {
    notice:
      'Sent, with the page reference attached. Whoever maintains this will come back to you with what changed, or why it is not a fault.',
  };
}

export async function ratePage(_state: FormState, form: FormData): Promise<FormState> {
  const { subject } = await requireReader();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified.' };
  }
  const pageId = field(form, 'pageId');
  const helpful = field(form, 'helpful') === 'yes';
  await db
    .insert(pageFeedback)
    .values({ userId: subject.userId, pageId, helpful })
    .onConflictDoUpdate({ target: [pageFeedback.userId, pageFeedback.pageId], set: { helpful } });
  return { notice: helpful ? 'Noted — thank you.' : 'Noted. It goes on the list of pages to rewrite.' };
}
