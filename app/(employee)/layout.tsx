import Link from 'next/link';
import { requireViewer } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';
import { SearchField } from './SearchField';

/**
 * The employee shell.
 *
 * Four destinations plus a persistent search affordance, per spec §8. The
 * prototype's six content-shaped tabs (My role, Rights and eligibility, Time
 * and hours) are NOT built: nothing in the admin console routes authored
 * content to them, so they could only be filled with words no admin wrote.
 * See docs/DECISIONS.md.
 */
export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = await requireViewer();
  const [company] = await sql()<{ display_name: string | null }[]>`
    SELECT display_name FROM company_setting WHERE singleton`;

  const tabs = [
    { href: '/home', label: 'Home' },
    { href: '/browse', label: 'Browse' },
    { href: '/mine', label: 'My things' },
    { href: '/help', label: 'Help' },
  ];

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>
      <div
        style={{
          maxWidth: 1060,
          margin: '0 auto',
          padding: 'clamp(24px, 4vw, 38px) clamp(22px, 4vw, 44px) 46px',
        }}
      >
        <header style={{ marginBottom: 26 }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>
            {company?.display_name ?? 'Your handbook'}
          </p>
          <SearchField />
          <nav className="tabbar no-print" style={{ marginTop: 22 }} aria-label="Sections">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className="tab">
                {t.label}
              </Link>
            ))}
            {session.isAdmin ? (
              <Link href="/admin" className="tab" style={{ marginLeft: 'auto' }}>
                Admin
              </Link>
            ) : null}
          </nav>
        </header>

        <main id="main">{children}</main>

        <footer
          className="no-print"
          style={{
            marginTop: 46,
            paddingTop: 16,
            borderTop: '1px solid var(--color-neutral-300)',
            display: 'flex',
            gap: 22,
            flexWrap: 'wrap',
            fontSize: 12.5,
          }}
        >
          <Link href="/help">Report something out of date</Link>
          <button
            className="inline-action"
            type="button"
            // Printing is the browser's own; no library, no motion.
            style={{ font: 'inherit', fontSize: 12.5 }}
          >
            Print this page
          </button>
        </footer>
      </div>
    </div>
  );
}
