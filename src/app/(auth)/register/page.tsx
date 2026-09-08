import { ActionForm } from '@/components/action-form';
import { register } from '../actions';
import { csrfToken } from '@/lib/csrf';
import { peekToken } from '@/lib/auth/tokens';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const csrf = await csrfToken();
  const invite = token ? await peekToken('invite', token) : null;

  if (!invite) {
    return (
      <>
        <p className="eyebrow">Join</p>
        <h1 className="page-title">This invitation is no longer open</h1>
        <p className="lead">
          Invitations work once and expire. Whoever sent yours can generate another in a moment — there is nothing to fix
          on your side.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Join</p>
      <h1 className="page-title">Set up your account</h1>
      <p className="lead">
        {invite.email ? `This invitation is for ${invite.email}.` : 'Tell us the address your colleagues use for you.'}
      </p>

      <ActionForm action={register} csrf={csrf} submitLabel="Create my account" pendingLabel="Creating…" hidden={{ token }}>
        {invite.email ? null : (
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" name="email" autoComplete="username" required />
          </label>
        )}
        <label className="field">
          <span>Name</span>
          <input className="input" type="text" name="displayName" autoComplete="name" required autoFocus />
          <span className="helper">The name your colleagues see on the org chart and on contact cards.</span>
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" name="password" autoComplete="new-password" required />
          <span className="helper">At least {MIN_PASSWORD_LENGTH} characters.</span>
        </label>
      </ActionForm>
    </>
  );
}
