import { ActionForm } from '@/components/action-form';
import { requestReset } from '../actions';
import { csrfToken } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export default async function ForgotPage() {
  const csrf = await csrfToken();
  return (
    <>
      <p className="eyebrow">Password</p>
      <h1 className="page-title">Send me a reset link</h1>
      <p className="lead">The link works once and expires in an hour.</p>
      <ActionForm action={requestReset} csrf={csrf} submitLabel="Send the link" pendingLabel="Sending…">
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" autoComplete="username" required autoFocus />
        </label>
      </ActionForm>
    </>
  );
}
