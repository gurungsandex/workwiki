import type { Metadata } from 'next';
import '@/styles/broadsheet.css';

export const metadata: Metadata = {
  title: 'Handbook',
  // No version disclosure, no product marketing on an employee's screen.
  description: 'Company information and guidance',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
