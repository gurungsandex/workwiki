import { ActionForm } from '@/components/action-form';
import { confirmReset } from '../actions';
import { csrfToken } from '@/lib/csrf';
import { peekToken } from '@/lib/auth/tokens';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const csrf = await csrfToken();
  const valid = token ? await peekToken('password_reset', token) : null;

  if (!valid) {
    return (
      <>
        <p className="eyebrow">Password</p>
        <h1 className="page-title">That link has expired</h1>
        <p className="lead">Reset links work once and last an hour. Ask for a new one and it will arrive shortly.</p>
        <p>
          <a className="btn btn-primary" href="/forgot" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Send a new link
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Password</p>
      <h1 className="page-title">Set a new password</h1>
      <ActionForm action={confirmReset} csrf={csrf} submitLabel="Save it" pendingLabel="Saving…" hidden={{ token }}>
        <label className="field">
          <span>New password</span>
          <input className="input" type="password" name="password" autoComplete="new-password" required autoFocus />
          <span className="helper">
            At least {MIN_PASSWORD_LENGTH} characters. A phrase you can remember beats a short scramble.
          </span>
        </label>
      </ActionForm>
    </>
  );
}
