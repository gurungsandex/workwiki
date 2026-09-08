import Link from 'next/link';
import { verifyEmail } from '../actions';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const ok = token ? await verifyEmail(token) : false;

  return (
    <>
      <p className="eyebrow">Email</p>
      <h1 className="page-title">{ok ? 'Address confirmed' : 'That link has expired'}</h1>
      <p className="lead">
        {ok
          ? 'Reset links and notices will reach you at this address from now on.'
          : 'Confirmation links work once and last three days. Sign in and we will send another.'}
      </p>
      <p>
        <Link href="/home">Go to your handbook</Link>
      </p>
    </>
  );
}
