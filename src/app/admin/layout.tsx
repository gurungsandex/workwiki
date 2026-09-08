import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { companyName, instanceSettings } from '@/lib/instance';
import { AdminTabs } from '@/components/admin-tabs';
import { signOut } from '../(auth)/actions';
import { db } from '@/db/client';
import { locations } from '@/db/schema';
import { isNull } from 'drizzle-orm';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const [settings, sites] = await Promise.all([
    instanceSettings(),
    db.select({ region: locations.region }).from(locations).where(isNull(locations.archivedAt)),
  ]);

  // The live jurisdiction line: derived from where people actually work.
  const regions = [...new Set(sites.map((s) => s.region).filter(Boolean))] as string[];

  return (
    <div className="sheet">
      <header className="topbar">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>
              Admin
            </p>
            <p style={{ margin: 0, fontSize: 17 }}>{companyName(settings)}</p>
          </div>
          <p className="meta" style={{ margin: 0, color: 'var(--color-neutral-400)' }}>
            {regions.length > 0 ? `Employing in ${regions.join(', ')} · ` : ''}
            <Link href="/home">Employee view</Link> ·{' '}
            <form action={signOut} style={{ display: 'inline' }}>
              <button className="inline-action" type="submit" style={{ color: 'var(--color-accent-300)' }}>
                Sign out
              </button>
            </form>
          </p>
        </div>
      </header>

      <AdminTabs />

      <main id="main" className="pad">
        {children}
      </main>

      <footer className="pad" style={{ paddingTop: 0 }}>
        <p className="meta" style={{ borderTop: '1px solid var(--color-neutral-300)', paddingTop: 12 }}>
          <Link href="/admin/audit">Audit log</Link> · <Link href="/admin/trash">Removed items</Link>
        </p>
      </footer>
    </div>
  );
}
