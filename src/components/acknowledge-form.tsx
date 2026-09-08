'use client';

import { useActionState } from 'react';
import { acknowledgePage } from '@/app/(employee)/actions';
import { CSRF_FIELD } from '@/lib/csrf-shared';

export function AcknowledgeForm({
  csrf,
  pageVersionId,
  contentHash,
  versionNo,
}: {
  csrf: string;
  pageVersionId: string;
  contentHash: string;
  versionNo: number;
}) {
  const [state, formAction, pending] = useActionState(acknowledgePage, {});

  if (state.notice) {
    return (
      <p className="notice" role="status">
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} className="no-print" style={{ marginTop: 26 }}>
      <input type="hidden" name={CSRF_FIELD} value={csrf} />
      <input type="hidden" name="pageVersionId" value={pageVersionId} />
      {/* The hash the browser actually rendered. A mismatch is rejected. */}
      <input type="hidden" name="contentHash" value={contentHash} />
      <p className="meta" style={{ marginBottom: 8 }}>
        Acknowledging records that you have read version {versionNo}, as it stands today.
      </p>
      {state.error ? (
        <p className="notice notice-attention" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Recording…' : 'I have read this'}
      </button>
    </form>
  );
}
