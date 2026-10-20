import Link from 'next/link';
import { Lock, ShieldCheck, Wrench } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getPlatformSettings } from '@/lib/platform-server';

export const metadata = { title: 'Scheduled maintenance · SokoGlobal' };
export const dynamic = 'force-dynamic';

/** Shown (via middleware rewrite, HTTP 503) to non-admins while maintenance mode is on. */
export default async function MaintenancePage() {
  const settings = await getPlatformSettings(await createClient());
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="card w-full max-w-lg p-8 text-center sm:p-10">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border tone-pending">
          <Wrench className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">We&apos;re doing some maintenance</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          {settings.banner_message ?? 'SokoGlobal is briefly offline while we upgrade the platform. Please check back in a few minutes.'}
        </p>
        <p className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-neutral-100 px-4 py-3 text-xs text-neutral-700">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> Funds held in escrow stay protected. Nothing is released or charged while we&apos;re offline.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:underline dark:text-cyan-300">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Staff sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
