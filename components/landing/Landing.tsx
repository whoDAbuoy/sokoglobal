import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, ClipboardCheck, Globe2, Lock, PackageCheck, Plane, ShieldCheck, Ship, Store, Wallet,
} from 'lucide-react';
import Globe from '@/components/motion/Globe';
import { formatUSD } from '@/lib/format';
import RotatingWord from '@/components/motion/RotatingWord';
import WaveBackground from '@/components/motion/WaveBackground';

const FEATURES = [
  { icon: Lock, tone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', title: 'Escrow on every order',
    body: 'Your payment waits with a licensed escrow partner and is released only after you verify the goods.' },
  { icon: PackageCheck, tone: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20', title: 'Guaranteed Landed Cost',
    body: 'Product, consolidated air freight and customs clearance in one fixed price, delivered to your door.' },
  { icon: BadgeCheck, tone: 'text-blue-400 bg-blue-500/10 border-blue-500/20', title: 'Verified suppliers',
    body: 'KYC-checked brands and wholesalers, real product photos and standardised swatch videos.' },
];

const STEPS = [
  { icon: Wallet, label: 'Pay into escrow', body: 'M-Pesa or bank card. Funds are held, not sent.' },
  { icon: Plane, label: 'In transit', body: 'Consolidated air freight with live tracking.' },
  { icon: ClipboardCheck, label: 'Customs cleared', body: 'Duties are already in your landed price.' },
  { icon: PackageCheck, label: 'Goods verified', body: 'You inspect at your door. Then the supplier is paid.' },
];

/** Public landing page (signed-out visitors). Always rendered in the midnight theme. */
/** minTrialCents: current trial batch minimum (system_configs, migration 018). */
export default function Landing({ minTrialCents = 50_000 }: { minTrialCents?: number }) {
  return (
    <div className="dark min-h-screen bg-midnight text-neutral-900">
      <header className="sticky top-3 z-50 px-3 sm:top-4 sm:px-4">
        <div className="glass-toolbar mx-auto flex h-14 max-w-7xl items-center justify-between px-3 sm:h-16 sm:px-5">
        <Link href="/" className="flex items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
          <ShieldCheck className="h-5 w-5 text-cyan-400" strokeWidth={2.25} aria-hidden />
          <span className="text-base font-semibold tracking-tight">SokoGlobal</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="press hidden rounded-md px-3 py-2 text-sm text-neutral-600 transition-colors hover:text-neutral-900 sm:inline">How it works</a>
          <Link href="/login" className="press rounded-md px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:text-neutral-900">Sign in</Link>
          <Link href="/signup" className="btn-primary px-3.5 py-2">Get started</Link>
        </nav>
        </div>
      </header>

      <main>
        {/* Hero: headline + interactive globe over the wave band */}
        <section className="relative isolate overflow-hidden">
          <WaveBackground band={0.72} className="-z-10" />
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:pb-28 lg:pt-16">
            <div className="motion-safe:animate-fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/60 px-3 py-1 text-xs text-neutral-700 backdrop-blur">
                <span className="rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-snow">B2B</span>
                Escrow-protected imports into Africa
                <ArrowRight className="h-3 w-3" aria-hidden />
              </p>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Global trade that feels{' '}
                <RotatingWord words={['effortless', 'borderless', 'alive']}
                  wordClassName="bg-gradient-to-r from-blue-400 via-cyan-300 to-indigo-400 bg-clip-text pb-2 text-transparent" />
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-neutral-600 sm:text-lg">
                Source from verified suppliers in Europe, the Americas and Asia. Pay one fixed landed price into escrow, track the
                shipment, and release funds only when the goods are at your door.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className="btn-primary px-5 py-3"><Store className="h-4 w-4" aria-hidden /> Start importing <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <Link href="/signup?role=supplier" className="btn-secondary border-neutral-300 bg-white/40 px-5 py-3 backdrop-blur"><Ship className="h-4 w-4" aria-hidden /> Sell as a supplier</Link>
              </div>
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-neutral-200 pt-6">
                {[[formatUSD(minTrialCents), 'Trial Batch to test a supplier'], ['100%', 'of payments held in escrow'], ['1 price', 'goods, freight and customs']].map(([v, l]) => (
                  <div key={l}>
                    <dt className="sr-only">{l}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
                    <dd className="mt-1 text-xs leading-snug text-neutral-500">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
              <Globe className="h-full w-full" focus={{ lat: 14, lon: 38 }} />
              <p className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[11px] text-neutral-500">
                <Globe2 className="mr-1 inline h-3 w-3" aria-hidden />Drag to explore trade corridors
              </p>
            </div>
          </div>
        </section>

        {/* Value props */}
        <section aria-labelledby="why" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="why" className="eyebrow text-cyan-400">Why SokoGlobal</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, tone, title, body }) => (
              <article key={title} className="card glow-hover card-lift p-6">
                <span className={`grid h-10 w-10 place-items-center rounded-lg border ${tone}`}><Icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How escrow works */}
        <section id="how" aria-labelledby="how-title" className="relative isolate overflow-hidden py-16">
          <WaveBackground band={0.5} intensity={0.45} speed={0.6} className="-z-10" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Your money moves only when your goods do.</h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, label, body }, i) => (
                <li key={label} className="card card-lift p-5">
                  <div className="flex items-center justify-between">
                    <span className="relative grid h-9 w-9 place-items-center rounded-full bg-blue-500/15 text-blue-400">
                      <span className="absolute inset-0 rounded-full border border-blue-400/40 motion-safe:animate-pulse-ring" style={{ animationDelay: `${i * 0.35}s` }} aria-hidden />
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-xs font-medium tabular-nums text-neutral-500">0{i + 1}</span>
                  </div>
                  <p className="mt-5 font-semibold">{label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-600">{body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary px-5 py-3">Create a free trade account <ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/login" className="btn-secondary bg-white/40 px-5 py-3 backdrop-blur">Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-neutral-500 sm:px-6 lg:px-8">
          <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-cyan-400" aria-hidden /> SokoGlobal · Escrow-protected B2B trade</p>
          <p>Funds held by a licensed escrow partner · 24/7 trade support</p>
        </div>
      </footer>
    </div>
  );
}
