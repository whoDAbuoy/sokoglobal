import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMpesaConfigured } from '@/lib/payments/mpesa';
import { isSuperAdmin } from '@/lib/auth/admin-access';
import { parseSettingsTab } from '@/lib/settings';
import { isTwoFactorConfigured } from '@/lib/security/two-factor';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import SettingsHub from '@/components/settings/SettingsHub';
import type { LatestChangeRequest } from '@/components/profile/ProfileChangeRequest';

export const metadata = { title: 'Settings · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface Extended {
  designation: string | null; phone_number: string | null; avatar_url: string | null;
  email_notifications: boolean; sms_alerts: boolean; order_status_updates: boolean; two_factor_enabled: boolean;
}

/** Settings hub for every signed-in role: account & avatar, security & 2FA, store / business details, notifications, appearance. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/settings');
  const { tab } = await searchParams;

  const [ext, changeReq, totp] = await Promise.all([
    supabase.from('profiles').select('designation, phone_number, avatar_url, email_notifications, sms_alerts, order_status_updates, two_factor_enabled')
      .eq('id', user.id).maybeSingle<Extended>(),
    supabase.from('profile_change_requests').select('status, full_name, company_name, review_note, created_at, reviewed_at')
      .eq('user_id', user.id).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle<LatestChangeRequest>(),
    supabase.from('user_totp_secrets').select('is_verified, verified_at').maybeSingle<{ is_verified: boolean; verified_at: string | null }>(),
  ]);
  const ready = !ext.error && !!ext.data;   // false until migration 016 is applied
  const d = ext.data;

  // Remaining backup codes: count only (the hashes never leave the server).
  let backupLeft: number | null = null;
  if (ready && totp.data?.is_verified) {
    try {
      const { data } = await createAdminClient().from('user_totp_secrets').select('backup_codes').eq('user_id', user.id).maybeSingle<{ backup_codes: string[] }>();
      backupLeft = data?.backup_codes.length ?? null;
    } catch { backupLeft = null; }
  }

  // Always dark (Sellsy layout), like the supplier portal: `.dark.sellsy` scopes the theme; AmbientBackdrop paints the canvas.
  return (
    <div className="dark sellsy min-h-screen text-neutral-900">
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Settings</h1>
        <SettingsHub
          initialTab={parseSettingsTab(tab)}
          profile={profile}
          email={user.email ?? ''}
          memberSince={user.created_at ?? null}
          changeRequest={changeReq.data ?? null}
          regional={{
            escrowCurrency: 'USD',
            cardCurrency: (process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase(),
            mpesaEnabled: process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true' && isMpesaConfigured(),
          }}
          details={{ designation: d?.designation ?? null, phone_number: d?.phone_number ?? null, avatar_url: d?.avatar_url ?? null }}
          prefs={{ email_notifications: d?.email_notifications ?? true, sms_alerts: d?.sms_alerts ?? false, order_status_updates: d?.order_status_updates ?? true }}
          twoFactor={{
            available: ready, enabled: !!d?.two_factor_enabled && !!totp.data?.is_verified, verifiedAt: totp.data?.verified_at ?? null,
            backupLeft, configured: isTwoFactorConfigured(), isSuperAdmin: isSuperAdmin(profile),
          }}
          ready={ready}
        />
      </main>
    </div>
  );
}
