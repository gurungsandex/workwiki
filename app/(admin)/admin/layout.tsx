import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '/admin', label: 'Setup' },
  { href: '/admin/structure', label: 'Departments and roles' },
  { href: '/admin/people', label: 'People' },
  { href: '/admin/content', label: 'Sections' },
  { href: '/admin/contacts', label: 'Who to ask' },
  { href: '/admin/rules', label: 'Who sees what' },
  { href: '/admin/health', label: 'Gaps and health' },
  { href: '/admin/queue', label: 'Reports and audit' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const [company] = await sql()<{ display_name: string | null }[]>`
    SELECT display_name FROM company_setting WHERE singleton`;

  return (
    <div style={{ background: 'var(--color-neutral-200)', minHeight: '100vh' }}>
      <div
        style={{
          background: 'var(--color-text)',
          color: 'var(--color-neutral-100)',
          padding: '10px 20px',
          display: 'flex',
          gap: 18,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 16 }}>{company?.display_name ?? 'This instance'}</span>
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--color-neutral-400)',
          }}
        >
          Admin
        </span>
        <Link
          href="/home"
          style={{ marginLeft: 'auto', color: 'var(--color-accent-300)', fontSize: 13 }}
        >
          Employee view
        </Link>
      </div>

      <div className="sheet" style={{ padding: '34px 30px 40px' }}>
        <nav className="tabbar" style={{ marginBottom: 30 }} aria-label="Admin sections">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="tab">
              {t.label}
            </Link>
          ))}
        </nav>
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
