import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { homePathFor } from '@/lib/auth/admin-access';
import { safeReturnPath } from '@/lib/security/two-factor-gate';
import { twoFactorState } from '@/lib/security/two-factor-server';
import TwoFactorChallenge from '@/components/settings/TwoFactorChallenge';

export const metadata = { title: 'Two-factor check · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Second step after password sign-in for accounts with 2FA on (middleware sends unverified sessions here). */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ redirectTo?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  const { redirectTo } = await searchParams;
  if (!user || !profile) redirect('/login');
  const next = safeReturnPath(redirectTo, homePathFor(profile.role));
  const state = await twoFactorState(supabase);
  if (!state.enabled || state.ok) redirect(next);

  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="card w-full max-w-md p-7 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-xl border tone-active">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">Two-factor check</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Enter the 6-digit code from your authenticator app for <strong className="font-medium text-neutral-900">{user.email}</strong>.
        </p>
        <TwoFactorChallenge next={next} />
      </div>
    </main>
  );
}
