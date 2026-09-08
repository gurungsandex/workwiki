'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Setup' },
  { href: '/admin/people', label: 'People' },
  { href: '/admin/structure', label: 'Departments and roles' },
  { href: '/admin/content', label: 'Sections' },
  { href: '/admin/contacts', label: 'Contacts' },
  { href: '/admin/access', label: 'Who sees what' },
  { href: '/admin/gaps', label: 'Gaps and health' },
  { href: '/admin/reports', label: 'Reports and audit' },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Admin sections">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          className="tab"
          href={tab.href}
          aria-current={tab.href === '/admin' ? (pathname === '/admin' ? 'page' : undefined) : pathname.startsWith(tab.href) ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
