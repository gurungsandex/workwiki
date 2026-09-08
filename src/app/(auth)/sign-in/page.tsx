import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { signIn } from '../actions';
import { csrfToken } from '@/lib/csrf';
import { currentUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  if (await currentUser()) redirect('/home');
  const csrf = await csrfToken();

  return (
    <>
      <p className="eyebrow">Sign in</p>
      <h1 className="page-title">Your handbook</h1>
      <p className="lead">Everything here is what your own record says applies to you.</p>

      <ActionForm action={signIn} csrf={csrf} submitLabel="Sign in" pendingLabel="Signing in…">
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" name="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" name="password" autoComplete="current-password" required />
        </label>
      </ActionForm>
    </>
  );
}
