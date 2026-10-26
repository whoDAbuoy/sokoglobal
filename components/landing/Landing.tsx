import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, ClipboardCheck, Globe2, Lock, PackageCheck, Plane, ShieldCheck, Ship, Store, Wallet,
} from 'lucide-react';
import Globe from '@/components/motion/Globe';
import { formatUSD } from '@/lib/format';
import RotatingWord from '@/components/motion/RotatingWord';
import WaveBackground from '@/components/motion/WaveBackground';

const STEPS = [
  { icon: Wallet, label: 'Pay into escrow', body: 'M-Pesa or bank card. Funds are held, not sent.' },
  { icon: Plane, label: 'In transit', body: 'Consolidated air freight with live tracking.' },
  { icon: ClipboardCheck, label: 'Customs cleared', body: 'Duties are already in your landed price.' },
  { icon: PackageCheck, label: 'Goods verified', body: 'You inspect at your door. Then the supplier is paid.' },
];

/** Modular dark card (Sellsy): charcoal at 80% over the mint waves, hairline rim, large radius. */
const MODULE = 'rounded-3xl border border-snow/5 bg-[#121212]/80 p-6 backdrop-blur-xl';
/** Glass action button (secondary): frosted pill that compresses when pressed. */
const GLASS_BTN = 'inline-flex items-center justify-center gap-2 rounded-full border border-snow/10 bg-snow/[0.06] px-5 py-3 text-sm font-medium text-neutral-900 backdrop-blur-xl transition-all duration-200 ease-out hover:border-snow/25 hover:bg-snow/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]';
const MINT_TEXT = 'bg-gradient-to-r from-[#8fd3cc] via-teal-300 to-cyan-300 bg-clip-text text-transparent';

/**
 * Public landing page (signed-out visitors), Sellsy layout: always dark (`.dark.sellsy`) on the #050505 canvas,
 * with mint waves and the interactive mint globe. minTrialCents: current trial batch minimum (system_configs, migration 018).
 */
export default function Landing({ minTrialCents = 50_000 }: { minTrialCents?: number }) {
  return (
    <div className="dark sellsy relative isolate min-h-screen overflow-x-clip bg-[#050505] text-neutral-900">
      {/* Ambient mint / teal glows behind everything. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="ambient-glow left-1/2 top-[-10rem] h-[40rem] w-[40rem] -translate-x-1/2 bg-[#5a9895]/20" />
        <div className="ambient-glow right-[-10rem] top-[40rem] h-[30rem] w-[30rem] bg-teal-500/10 [animation-delay:-9s]" />
        <div className="ambient-glow bottom-0 left-[-10rem] h-[30rem] w-[30rem] bg-cyan-500/[0.08] [animation-delay:-18s]" />
      </div>

      <header className="sticky top-3 z-50 px-3 sm:top-4 sm:px-4">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between rounded-full border border-snow/10 bg-[#050505]/60 px-3 shadow-2xl backdrop-blur-xl sm:h-16 sm:px-5">
          <Link href="/" className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
            <ShieldCheck className="h-5 w-5 text-[#8fd3cc]" strokeWidth={2.25} aria-hidden />
            <span className="text-base font-semibold tracking-tight">SokoGlobal</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="#how" className="press hidden rounded-full px-3 py-2 text-sm text-neutral-600 transition-colors hover:text-neutral-900 sm:inline">How it works</a>
            <Link href="/login" className="press rounded-full px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:text-neutral-900">Sign in</Link>
            <Link href="/signup" className="btn-primary px-4 py-2">Get started</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: centred headline, then the interactive globe ringed by mint glow over the wave band. */}
        <section className="relative isolate overflow-hidden">
          <WaveBackground band={0.78} palette="mint" className="-z-10" />
          <div className="mx-auto max-w-5xl px-4 pt-14 text-center sm:px-6 lg:pt-20">
            <div className="motion-safe:animate-fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-snow/10 bg-snow/[0.04] px-3 py-1 text-xs text-neutral-700 backdrop-blur">
                <span className="rounded-full bg-[#5a9895] px-1.5 py-px text-[10px] font-semibold text-snow">B2B</span>
                Escrow-protected imports into Africa
                <ArrowRight className="h-3 w-3" aria-hidden />
              </p>
              <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Global trade that feels{' '}
                <RotatingWord words={['effortless', 'borderless', 'alive']} wordClassName={`${MINT_TEXT} pb-2`} />
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg">
                Source from verified suppliers in Europe, the Americas and Asia. Pay one fixed landed price into escrow, track the
                shipment, and release funds only when the goods are at your door.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/signup" className="btn-primary px-5 py-3 active:scale-95"><Store className="h-4 w-4" aria-hidden /> Start importing <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <Link href="/signup?role=supplier" className={GLASS_BTN}><Ship className="h-4 w-4" aria-hidden /> Sell as a supplier</Link>
              </div>
            </div>
          </div>

          <div className="relative mx-auto mt-6 aspect-square w-full max-w-[38rem] px-4">
            <div aria-hidden className="pointer-events-none absolute inset-[12%] rounded-full bg-[#5a9895]/25 blur-[90px]" />
            <Globe className="h-full w-full" focus={{ lat: 14, lon: 38 }} palette="mint" />
            <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-neutral-500">
              <Globe2 className="mr-1 inline h-3 w-3" aria-hidden />Drag to explore trade corridors
            </p>
          </div>

          <div className="mx-auto -mt-10 max-w-3xl px-4 pb-20 sm:px-6 lg:pb-24">
            <dl className="sx-glass relative grid grid-cols-3 gap-4 p-5 text-center sm:p-6">
              {[[formatUSD(minTrialCents), 'Trial Batch to test a supplier'], ['100%', 'of payments held in escrow'], ['1 price', 'goods, freight and customs']].map(([v, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="text-2xl font-semibold tabular-nums sm:text-3xl">{v}</dd>
                  <dd className="mt-1 text-xs leading-snug text-neutral-500">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Value props: asymmetric modular cards (4 / 2, then 2 / 4). */}
        <section aria-labelledby="why" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="why" className="eyebrow text-[#8fd3cc]">Why SokoGlobal</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-6">
            <article className={`${MODULE} glow-hover md:col-span-4 md:p-8`}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#5a9895]/20 text-[#8fd3cc]"><Lock className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">Escrow on every order</h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
                Your payment waits with a licensed escrow partner and is released only after you verify the goods.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {['Held, not sent', 'Released on verification', 'Disputes handled'].map((t) => (
                  <span key={t} className="sx-pill sx-pill-mint">{t}</span>
                ))}
              </div>
            </article>
            <article className={`${MODULE} glow-hover md:col-span-2`}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-teal-400/15 text-teal-300"><PackageCheck className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-6 text-lg font-semibold">Guaranteed Landed Cost</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">Product, consolidated air freight and customs clearance in one fixed price, delivered to your door.</p>
            </article>
            <article className={`${MODULE} glow-hover md:col-span-2`}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-cyan-400/15 text-cyan-300"><BadgeCheck className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-6 text-lg font-semibold">Verified suppliers</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">KYC-checked brands and wholesalers, real product photos and standardised swatch videos.</p>
            </article>
            <article className={`${MODULE} glow-hover flex flex-col justify-between gap-6 md:col-span-4 md:flex-row md:items-end md:p-8`}>
              <div>
                <p className="eyebrow">Trial Batch</p>
                <p className="sx-stat mt-3">{formatUSD(minTrialCents)}</p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">Test a new supplier with one small, fully landed order before you commit to volume.</p>
              </div>
              <Link href="/signup" className={GLASS_BTN}>Try a supplier <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            </article>
          </div>
        </section>

        {/* How escrow works */}
        <section id="how" aria-labelledby="how-title" className="relative isolate scroll-mt-24 overflow-hidden py-16">
          <WaveBackground band={0.5} intensity={0.45} speed={0.6} palette="mint" className="-z-10" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 id="how-title" className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Your money moves only when <span className={MINT_TEXT}>your goods do.</span>
            </h2>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, label, body }, i) => (
                <li key={label} className={`${MODULE} p-5`}>
                  <div className="flex items-center justify-between">
                    <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[#5a9895]/20 text-[#8fd3cc]">
                      <span className="absolute inset-0 rounded-full border border-[#5a9895]/50 motion-safe:animate-pulse-ring" style={{ animationDelay: `${i * 0.35}s` }} aria-hidden />
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-xs font-medium tabular-nums text-neutral-500">0{i + 1}</span>
                  </div>
                  <p className="mt-5 font-semibold">{label}</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-600">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* CTA banner: mint-to-cyan glow under frosted glass. */}
        <section aria-labelledby="cta-title" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="relative isolate overflow-hidden rounded-3xl border border-snow/10 p-8 shadow-2xl sm:p-12">
            <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_0%_0%,rgb(90_152_149/0.45),transparent_60%),radial-gradient(70%_100%_at_100%_100%,rgb(34_211_238/0.25),transparent_60%)]" />
            <div aria-hidden className="absolute inset-0 -z-10 bg-gray-900/40 backdrop-blur-xl" />
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <h2 id="cta-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Open your trade account today.</h2>
                <p className="mt-3 text-sm leading-relaxed text-neutral-700 sm:text-base">Free to join. Your first order is escrow-protected from the moment you pay.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className="btn-primary px-5 py-3 active:scale-95">Create a free trade account <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <Link href="/login" className={GLASS_BTN}>Sign in</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-snow/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-neutral-500 sm:px-6 lg:px-8">
          <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#8fd3cc]" aria-hidden /> SokoGlobal · Escrow-protected B2B trade</p>
          <p>Funds held by a licensed escrow partner · 24/7 trade support</p>
        </div>
      </footer>
    </div>
  );
}
