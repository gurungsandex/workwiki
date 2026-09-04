import { redirect } from 'next/navigation';
import { setupComplete } from '@/lib/auth/guard';
import { currentSession } from '@/lib/auth/session';
import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/** A fresh install goes to setup; everyone else to sign-in or their handbook. */
export default async function Root() {
  if (!(await setupComplete())) redirect('/setup');
  const session = await currentSession(sql());
  if (!session) redirect('/login');
  redirect('/home');
}
