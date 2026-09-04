export const metadata = { title: 'Not set up yet' };

/**
 * A signed-in user with no employee record. Specific, never generic: it says
 * what is missing and who fixes it, rather than showing an empty handbook.
 */
export default function NoProfile() {
  return (
    <main id="main" style={{ maxWidth: '62ch', margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 34, lineHeight: 1.1, marginBottom: 12 }}>
        Your record is not set up yet
      </h1>
      <p className="lead">
        Your account exists, but nobody has recorded your department, role, employee
        type or site yet — and this handbook decides what to show you from exactly
        those things. Ask whoever invited you to finish your record, and this page
        becomes your handbook.
      </p>
    </main>
  );
}
