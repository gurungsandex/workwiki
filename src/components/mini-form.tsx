'use client';

import { useActionState } from 'react';
import { CSRF_FIELD } from '@/lib/csrf-shared';

export interface FormState {
  error?: string;
  notice?: string;
}

/** An inline action with its own feedback sentence. No dialogs, no motion. */
export function MiniForm({
  action,
  csrf,
  hidden,
  label,
  destructive,
  confirm,
  children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  csrf: string;
  hidden?: Record<string, string>;
  label: string;
  destructive?: boolean;
  confirm?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form
      action={formAction}
      style={{ display: 'inline' }}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <button
        className={`inline-action${destructive ? ' inline-action-destructive' : ''}`}
        type="submit"
        disabled={pending}
      >
        {pending ? '…' : label}
      </button>
      {state.error ? (
        <span className="meta attention" role="alert">
          {' '}
          {state.error}
        </span>
      ) : null}
      {state.notice ? (
        <span className="meta" role="status">
          {' '}
          {state.notice}
        </span>
      ) : null}
    </form>
  );
}
