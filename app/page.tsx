import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import Landing from '@/components/landing/Landing';
import { homePathFor } from '@/lib/auth/admin-access';

export const metadata = { title: 'SokoGlobal · Escrow-protected B2B imports' };

/** Signed-in users go to their portal (role-based, as before); visitors see the landing page. */
export default async function Home() {
  const { user, profile } = await getSessionProfile();
  if (!user) return <Landing />;
  redirect(homePathFor(profile?.role));
}
