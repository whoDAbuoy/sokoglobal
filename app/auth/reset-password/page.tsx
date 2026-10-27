import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { homePathFor } from '@/lib/auth/admin-access';
import { isRecentRecovery } from '@/lib/password';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata = { title: 'Set a new password · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Last step of "Forgot password?": the emailed link goes through /auth/callback, which signs the user in
 * with a recovery session and sends them here to choose a new password (no current password needed).
 */
export default async function ResetPasswordPage() {
  const { supabase, user, profile } = await getSessionProfile();
  const { data: claims } = user ? await supabase.auth.getClaims() : { data: null };
  const recovery = !!user && isRecentRecovery(claims?.claims?.amr, Math.floor(Date.now() / 1000));

  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="card w-full max-w-md p-7 sm:p-9">
        <span className="grid h-12 w-12 place-items-center rounded-xl border tone-active">
          <KeyRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        {recovery ? (
          <>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">Set a new password</h1>
            <p className="mt-2 text-sm text-neutral-600">
              For <strong className="font-medium text-neutral-900">{user.email}</strong>. At least 10 characters, with upper &amp; lower case
              letters or a number and a symbol.
            </p>
            <ResetPasswordForm home={homePathFor(profile?.role)} />
          </>
        ) : user ? (
          <>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">Change your password in Settings</h1>
            <p className="mt-2 text-sm text-neutral-600">
              You’re signed in, so this page doesn’t apply. Change your password under Settings → Security, or request a new reset link if you
              followed an old one.
            </p>
            <Link href="/dashboard/settings?tab=security" className="btn-primary mt-6">Open Security settings</Link>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">Reset link expired</h1>
            <p className="mt-2 text-sm text-neutral-600">
              That link is invalid or has already been used. Enter your email on the sign-in page and choose “Forgot password?” to get a new one.
            </p>
            <Link href="/login" className="btn-primary mt-6">Back to sign in</Link>
          </>
        )}
      </div>
    </main>
  );
}
