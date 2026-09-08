'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { issueReports, pages, users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/guards';
import { appendAudit } from '@/lib/audit';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { sendMail } from '@/lib/mail';
import { env } from '@/env';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolving *and* dismissing require a reason, and that reason goes back to the
 * reporter. The database refuses a closure without one; this is the sentence
 * that makes it worth reading.
 */
export async function closeReport(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  try {
    await assertCsrf(field(form, CSRF_FIELD));
  } catch {
    return { error: 'That request could not be verified. Reload the page and try again.' };
  }

  const id = field(form, 'id');
  const outcome = field(form, 'outcome');
  const state = field(form, 'state') === 'dismissed' ? 'dismissed' : 'resolved';

  if (outcome.length < 5) {
    return {
      error:
        state === 'dismissed'
          ? 'Say why it is not a fault. Those words go back to whoever reported it.'
          : 'Say what changed. Those words go back to whoever reported it.',
    };
  }

  const [report] = await db
    .update(issueReports)
    .set({ state, outcome, resolvedBy: admin.id, resolvedAt: new Date() })
    .where(eq(issueReports.id, id))
    .returning({ reporterId: issueReports.reporterId, pageId: issueReports.pageId, body: issueReports.body });

  if (!report) return { error: 'That report no longer exists.' };

  const [page] = report.pageId
    ? await db.select({ title: pages.title, slug: pages.slug }).from(pages).where(eq(pages.id, report.pageId)).limit(1)
    : [];

  if (report.reporterId) {
    const [reporter] = await db.select({ email: users.email }).from(users).where(eq(users.id, report.reporterId)).limit(1);
    if (reporter?.email) {
      await sendMail({
        to: reporter.email,
        subject: page ? `About what you reported on “${page.title}”` : 'About what you reported',
        text:
          `You reported:\n\n  ${report.body}\n\n` +
          (state === 'resolved' ? `What changed:\n\n  ${outcome}\n\n` : `Why this is not a fault:\n\n  ${outcome}\n\n`) +
          (page ? `${env.APP_BASE_URL}/p/${page.slug}\n` : ''),
      });
    }
  }

  await appendAudit({
    actorUserId: admin.id,
    action: state === 'resolved' ? 'issue.resolve' : 'issue.dismiss',
    area: 'Content',
    targetType: 'issue_report',
    targetId: id,
    summary:
      state === 'resolved'
        ? `Report resolved: ${outcome}. The reporter has been told.`
        : `Report dismissed: ${outcome}. The reporter has been told.`,
  });

  revalidatePath('/admin/reports');
  return {
    notice:
      state === 'resolved'
        ? 'Resolved, and your words have gone back to whoever reported it.'
        : 'Dismissed, and your reason has gone back to whoever reported it.',
  };
}
