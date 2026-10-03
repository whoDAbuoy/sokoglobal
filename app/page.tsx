import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';

/** Role-based entry point. */
export default async function Home() {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect('/login');
  redirect(profile?.role === 'admin' ? '/admin' : profile?.role === 'supplier' ? '/supplier' : '/dashboard');
}
