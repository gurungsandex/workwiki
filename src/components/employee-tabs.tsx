'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Four destinations plus the org chart. Search is the primary navigation. */
const TABS = [
  { href: '/home', label: 'Home' },
  { href: '/browse', label: 'Browse' },
  { href: '/my/acknowledgments', label: 'My things' },
  { href: '/help', label: 'Help' },
  { href: '/org', label: 'Org chart' },
];

export function EmployeeTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs no-print" aria-label="Sections">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          className="tab"
          href={tab.href}
          aria-current={pathname === tab.href || pathname.startsWith(`${tab.href}/`) ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
