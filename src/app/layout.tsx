import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { instanceSettings } from '@/lib/instance';
import './globals.css';

export const metadata: Metadata = {
  title: 'Handbook',
  // No version disclosure, and nothing about this deployment in a crawler index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, hdrs] = await Promise.all([instanceSettings(), headers()]);
  const nonce = hdrs.get('x-nonce') ?? undefined;
  /*
   * Validated when it is saved, and validated again here: this value is
   * interpolated into a stylesheet, so it never leaves this file unchecked.
   */
  const stored = settings?.accentColor ?? '';
  const accent = /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : null;

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {accent ? (
          // The company's accent, set at setup, overrides the token.
          <style nonce={nonce}>{`:root{--color-accent:${accent};}`}</style>
        ) : null}
        {children}
      </body>
    </html>
  );
}
