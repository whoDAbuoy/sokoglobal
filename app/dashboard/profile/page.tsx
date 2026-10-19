import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { isMpesaConfigured } from '@/lib/payments/mpesa';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ProfileSettings, { type ProfileTab } from '@/components/profile/ProfileSettings';

export const metadata = { title: 'Profile & settings · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TABS: ProfileTab[] = ['account', 'appearance', 'security'];

/** Profile card + settings for every signed-in role (each user only ever sees their own account). */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/profile');
  const { tab } = await searchParams;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Profile &amp; settings</h1>
        <ProfileSettings
          initialTab={TABS.includes(tab as ProfileTab) ? (tab as ProfileTab) : 'account'}
          profile={profile}
          email={user.email ?? ''}
          memberSince={user.created_at ?? null}
          regional={{
            escrowCurrency: 'USD',
            cardCurrency: (process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase(),
            mpesaEnabled: process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true' && isMpesaConfigured(),
          }}
        />
      </main>
    </>
  );
}
