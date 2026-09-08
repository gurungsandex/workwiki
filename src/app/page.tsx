import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/guards';
import { needsFirstAdmin } from '@/lib/setup';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  if (await needsFirstAdmin()) redirect('/setup');
  const user = await currentUser();
  redirect(user ? '/home' : '/sign-in');
}
