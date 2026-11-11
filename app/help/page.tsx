import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, BookOpen, Compass, LifeBuoy, MessageSquare } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { guidesFor, parseAudience, showMeHref, type Audience } from '@/lib/help-guides';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { PublicHeader } from '@/components/public/PublicCatalog';

export const metadata: Metadata = {
  title: 'Help Center · SokoGlobal',
  description: 'Step-by-step guides for importers and suppliers: escrow, verification, ordering, Trend Pools, quotes, shipping and payouts.',
  alternates: { canonical: '/help' },
};
export const dynamic = 'force-dynamic';

const AUDIENCES: [Audience, string][] = [['buyer', 'For importers'], ['supplier', 'For suppliers']];

/**
 * Help Center: short how-to guides (lib/help-guides.ts). "Show me on the page" opens the page with its guided tour
 * (lib/tours.ts). Public; signed-in users keep their portal header and see their own role's guides first.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const [{ profile }, params] = await Promise.all([getSessionProfile(), searchParams]);
  const audience = parseAudience(params.for, profile?.role === 'supplier' ? 'supplier' : 'buyer');
  const guides = guidesFor(audience);
  const signedIn = !!profile;
  const messagesHref = profile?.role === 'supplier' ? '/supplier/messages' : '/dashboard/messages';

  return (
    <div className="dark sellsy min-h-screen text-neutral-900">
      {profile ? <DashboardHeader profile={profile} /> : <PublicHeader />}
      <main className="mx-auto w-full max-w-4xl px-4 pb-20 pt-10 sm:px-6">
        <p className="eyebrow">Help Center</p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold"><LifeBuoy className="h-7 w-7 text-neutral-500" aria-hidden /> How can we help?</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Short guides for everything on SokoGlobal. Tap <strong className="font-medium text-neutral-900">Show me on the page</strong> to open the page
          with a guided tour, or use the <strong className="font-medium text-neutral-900">Guide</strong> button at the end of the menu on any page.
        </p>

        <nav aria-label="Guides for" className="mt-6 inline-flex rounded-full border border-neutral-300 p-0.5">
          {AUDIENCES.map(([a, label]) => (
            <Link key={a} href={`/help?for=${a}`} scroll={false} aria-current={audience === a ? 'page' : undefined}
              className={clsx('rounded-full px-4 py-1.5 text-sm font-medium', audience === a ? 'bg-[#ffffff] text-[#0a0a0a]' : 'text-neutral-600 hover:text-neutral-900')}>
              {label}
            </Link>
          ))}
        </nav>

        <ul className="mt-6 space-y-3">
          {guides.map((g, i) => (
            <li key={g.id}>
              <details id={g.id} className="glass-card group scroll-mt-24 p-5 [&_summary::-webkit-details-marker]:hidden" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start gap-3">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-[#8fd3cc]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-neutral-900">{g.title}</span>
                    <span className="mt-0.5 block text-sm text-neutral-600">{g.summary}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <ol className="mt-4 space-y-2 pl-8 text-sm text-neutral-700">
                  {g.steps.map((s, n) => (
                    <li key={n} className="relative">
                      <span aria-hidden className="absolute -left-8 grid h-5 w-5 place-items-center rounded-full border border-neutral-300 text-[11px] tabular-nums text-neutral-600">{n + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                {(g.show || g.more) && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 pl-8">
                    {g.show && (
                      <Link href={signedIn ? showMeHref(g.show) : `/login?redirectTo=${encodeURIComponent(showMeHref(g.show))}`} className="btn-primary px-4 py-2 text-sm">
                        <Compass className="h-4 w-4" aria-hidden /> Show me on the page
                      </Link>
                    )}
                    {g.more && <Link href={g.more.href} className="text-sm font-medium text-neutral-900 underline underline-offset-4">{g.more.label}</Link>}
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>

        <section className="glass-card mt-10 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-medium text-neutral-900">Still stuck?</h2>
            <p className="mt-0.5 text-sm text-neutral-600">Message our trade support team. We usually reply within a few hours.</p>
          </div>
          <Link href={signedIn ? messagesHref : '/login'} className="btn-secondary"><MessageSquare className="h-4 w-4" aria-hidden /> Contact support</Link>
        </section>
      </main>
    </div>
  );
}
