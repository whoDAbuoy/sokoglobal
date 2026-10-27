import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import Landing from '@/components/landing/Landing';
import { getSystemConfigs } from '@/lib/system-config-server';
import { minimumCents } from '@/lib/trial-batch';
import { homePathFor } from '@/lib/auth/admin-access';

// Title and description come from the root layout (app/layout.tsx); the homepage is canonical at the site root.
export const metadata = { alternates: { canonical: '/' } };

/** Signed-in users go to their portal (role-based, as before); visitors see the landing page. */
export default async function Home() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) return <Landing minTrialCents={minimumCents((await getSystemConfigs(supabase)).trial)} />;
  redirect(homePathFor(profile?.role));
}
