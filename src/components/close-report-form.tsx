'use client';

import { useActionState } from 'react';
import { CSRF_FIELD } from '@/lib/csrf-shared';

export interface FormState {
  error?: string;
  notice?: string;
}

/** Both closures require a reason, and the reason goes back to the reporter. */
export function CloseReportForm({
  csrf,
  action,
  id,
}: {
  csrf: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  id: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.notice) {
    return (
      <p className="meta" role="status" style={{ margin: '6px 0 0' }}>
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} style={{ marginTop: 8 }}>
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      <input type="hidden" name="id" value={id} />
      <label className="field" style={{ marginBottom: 8 }}>
        <span>What changed, or why it is not a fault</span>
        <textarea className="input" name="outcome" rows={2} required />
        <span className="helper">These words are sent to whoever reported it.</span>
      </label>
      {state.error ? (
        <p className="notice notice-attention" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" name="state" value="resolved" disabled={pending}>
        {pending ? 'Sending…' : 'Resolve it'}
      </button>{' '}
      <button className="btn" type="submit" name="state" value="dismissed" disabled={pending}>
        Not a fault
      </button>
    </form>
  );
}
