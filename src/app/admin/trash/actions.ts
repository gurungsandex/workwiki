'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { assertCsrf, CSRF_FIELD } from '@/lib/csrf';
import { ContentError, purge } from '@/lib/content/mutations';

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** The separate, explicit, audited action. */
export async function purgeAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const admin = await requireAdmin();
    await assertCsrf(field(form, CSRF_FIELD));
    const kind = field(form, 'kind') as 'section' | 'topic' | 'page';
    await purge(kind, field(form, 'id'), admin.id);
    revalidatePath('/admin/trash');
    return { notice: 'Purged. That one is not recoverable.' };
  } catch (error) {
    if (error instanceof ContentError) return { error: error.message };
    return { error: 'That could not be verified. Reload the page and try again.' };
  }
}
