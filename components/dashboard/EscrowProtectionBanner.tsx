import { Lock, PackageCheck, ShieldCheck, Truck } from 'lucide-react';

const STEPS = [
  { icon: Lock, title: 'You pay into escrow', body: 'Funds held by our licensed partner — never sent straight to the supplier.' },
  { icon: Truck, title: 'We ship & clear customs', body: 'Consolidated air freight and clearance are included in your landed cost.' },
  { icon: PackageCheck, title: 'You verify at your door', body: 'Inspect the goods. Only then is the supplier paid. Issues? Open a dispute.' },
];

/** The primary trust surface: explains escrow in three steps, above the fold. */
export default function EscrowProtectionBanner() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand-950 text-white">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" />
      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1.6fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            <ShieldCheck className="h-3.5 w-3.5" /> 100% Escrow Protection
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Your money moves only when your goods do.</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Every order on SokoGlobal is escrow-protected from checkout to doorstep — with a full refund if goods don&apos;t match.
          </p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-xs font-semibold">{i + 1}</span>
                <Icon className="h-4 w-4 text-emerald-300" />
              </div>
              <p className="mt-3 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
