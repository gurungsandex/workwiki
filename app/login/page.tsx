import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main id="main" style={{ maxWidth: 420, margin: '0 auto', padding: '64px 24px' }}>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Your company handbook
      </p>
      <h1 style={{ fontSize: 34, lineHeight: 1.1, marginBottom: 10 }}>Sign in</h1>
      <p className="lead" style={{ marginBottom: 28 }}>
        Everything here is written by your own company. You will only see the parts
        that apply to your record.
      </p>
      <LoginForm />
    </main>
  );
}
