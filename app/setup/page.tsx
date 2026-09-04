import { redirect } from 'next/navigation';
import { setupComplete } from '@/lib/auth/guard';
import { SetupForm } from './SetupForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up' };

export default async function Setup() {
  // Once an admin exists this route is closed.
  if (await setupComplete()) redirect('/login');

  return (
    <main id="main" style={{ maxWidth: 560, margin: '0 auto', padding: '56px 24px' }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>First run</p>
      <h1 style={{ fontSize: 34, lineHeight: 1.1, marginBottom: 12 }}>
        Set up this instance
      </h1>
      <p className="lead" style={{ marginBottom: 30 }}>
        This platform ships knowing nothing about your company — no departments, no
        roles, no policies, no jurisdictions. You create all of it, and nothing reaches
        an employee that you did not write, confirm or publish. Start with an account
        and a name.
      </p>
      <SetupForm />
    </main>
  );
}
