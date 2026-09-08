'use client';

import { useActionState } from 'react';
import { CSRF_FIELD } from '@/lib/csrf-shared';

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * One form wrapper: the CSRF field, the pending state and the one sentence of
 * feedback. Feedback is a sentence in the flow of the page, not a toast — this
 * system has no motion.
 */
export function ActionForm({
  action,
  csrf,
  submitLabel,
  pendingLabel,
  children,
  hidden,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  csrf: string;
  submitLabel: string;
  pendingLabel?: string;
  children?: React.ReactNode;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {state.error ? (
        <p className="notice notice-attention" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="notice" role="status">
          {state.notice}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? (pendingLabel ?? 'Working…') : submitLabel}
      </button>
    </form>
  );
}
