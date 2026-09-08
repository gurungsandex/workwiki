import Link from 'next/link';
import { requireUser } from '@/lib/auth/guards';
import { companyName, instanceSettings } from '@/lib/instance';
import { EmployeeTabs } from '@/components/employee-tabs';
import { SearchField } from '@/components/search-field';
import { signOut } from '../(auth)/actions';

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const [user, settings] = await Promise.all([requireUser(), instanceSettings()]);

  return (
    <div className="sheet">
      <header className="topbar">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>
              Handbook
            </p>
            <p style={{ margin: 0, fontSize: 17 }}>{companyName(settings)}</p>
          </div>
          <p className="meta" style={{ margin: 0, color: 'var(--color-neutral-400)' }}>
            {user.isAdmin ? <Link href="/admin">Admin console</Link> : null}
            {user.isAdmin ? ' · ' : null}
            <form action={signOut} style={{ display: 'inline' }}>
              <button className="inline-action" type="submit" style={{ color: 'var(--color-accent-300)' }}>
                Sign out
              </button>
            </form>
          </p>
        </div>
      </header>

      <div className="pad" style={{ paddingBottom: 0 }}>
        <SearchField />
      </div>

      <EmployeeTabs />

      <main id="main" className="pad">
        {children}
      </main>

      <footer className="pad no-print" style={{ paddingTop: 0 }}>
        <p className="meta" style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 12 }}>
          <Link href="/help">Who to ask</Link> · <Link href="/report">Report something out of date</Link>
        </p>
      </footer>
    </div>
  );
}
