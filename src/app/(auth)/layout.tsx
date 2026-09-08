import Link from 'next/link';
import { companyName, instanceSettings } from '@/lib/instance';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const settings = await instanceSettings();
  return (
    <div className="sheet">
      <div className="topbar">
        <p className="eyebrow" style={{ margin: 0 }}>
          {companyName(settings)}
        </p>
      </div>
      <main id="main" className="pad" style={{ maxWidth: 560 }}>
        {children}
      </main>
      <footer className="pad" style={{ paddingTop: 0 }}>
        <p className="meta" style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 12 }}>
          <Link href="/sign-in">Sign in</Link> · <Link href="/forgot">Forgotten password</Link>
        </p>
      </footer>
    </div>
  );
}
