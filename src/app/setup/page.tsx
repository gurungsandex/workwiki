import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { createFirstAdmin } from './actions';
import { csrfToken } from '@/lib/csrf';
import { needsFirstAdmin } from '@/lib/setup';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

/**
 * The setup wizard is the whole empty state. It cannot be skipped, and it can
 * be revisited — the rest of it lives in the admin console, where the checklist
 * reflects real state rather than a stored step number.
 */
export default async function SetupPage() {
  if (!(await needsFirstAdmin())) redirect('/sign-in');
  const csrf = await csrfToken();

  return (
    <div className="sheet">
      <div className="topbar">
        <p className="eyebrow" style={{ margin: 0 }}>
          First run
        </p>
      </div>
      <main id="main" className="pad" style={{ maxWidth: 640 }}>
        <p className="eyebrow">Step 1 of 6</p>
        <h1 className="page-title">Claim this deployment</h1>
        <p className="lead">
          This instance knows nothing about your company yet — no departments, no policies, no jurisdictions. Everything
          in it will be something you write or confirm. Start with the account that administers it.
        </p>

        <ActionForm action={createFirstAdmin} csrf={csrf} submitLabel="Create the account" pendingLabel="Creating…">
          <label className="field">
            <span>Company display name</span>
            <input className="input" type="text" name="companyName" required autoFocus />
            <span className="helper">What employees see at the top of every screen. The legal name comes later.</span>
          </label>
          <label className="field">
            <span>Your email</span>
            <input className="input" type="email" name="email" autoComplete="username" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" name="password" autoComplete="new-password" required />
            <span className="helper">At least {MIN_PASSWORD_LENGTH} characters.</span>
          </label>
          <label className="field">
            <span>Timezone</span>
            <input className="input" type="text" name="timeZone" defaultValue="UTC" required />
            <span className="helper">
              An IANA name, like America/New_York. Unlock dates resolve at local midnight here unless a site sets its own.
            </span>
          </label>
        </ActionForm>
      </main>
    </div>
  );
}
