import { JoinForm } from './JoinForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set your password' };

/**
 * Redeeming an invite. The token stays in the URL and is posted from here; it
 * is never rendered into the page or logged.
 */
export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main id="main" style={{ maxWidth: 440, margin: '0 auto', padding: '64px 24px' }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Your company handbook</p>
      <h1 style={{ fontSize: 34, lineHeight: 1.1, marginBottom: 12 }}>Set your password</h1>
      {token ? (
        <>
          <p className="lead" style={{ marginBottom: 28 }}>
            Once this is set you can sign in. You will only ever see the parts of the
            handbook that apply to your own record.
          </p>
          <JoinForm token={token} />
        </>
      ) : (
        <p className="lead">
          This page needs the link your company sent you. Open that link again, or ask
          for a new one.
        </p>
      )}
    </main>
  );
}
