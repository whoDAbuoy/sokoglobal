import { Lock, PackageCheck, ShieldCheck, Truck } from 'lucide-react';

const STEPS = [
  { icon: Lock, tone: 'tone-escrow', title: 'You pay into escrow', body: 'SokoGlobal holds the funds for your order — never sent straight to the supplier.' },
  { icon: Truck, tone: 'tone-transit', title: 'We ship & clear customs', body: 'Consolidated air freight and clearance are included in your landed cost.' },
  { icon: PackageCheck, tone: 'tone-active', title: 'You verify at your door', body: 'Inspect the goods. Only then is the supplier paid. Issues? Open a dispute.' },
];

/** The primary trust surface: explains escrow in three steps, above the fold. */
export default function EscrowProtectionBanner() {
  return (
    <section className="grid gap-12 lg:grid-cols-[1.1fr_1.4fr] lg:items-end">
      <div>
        <span className="pill tone-escrow">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> 100% Escrow Protection
        </span>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.1] text-neutral-900 sm:text-5xl">Your money moves only when your goods do.</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-neutral-600">
          Every order on SokoGlobal is escrow-protected from checkout to doorstep — with a full refund if goods don&apos;t match.
        </p>
      </div>
      <ol className="grid gap-8 sm:grid-cols-3 sm:gap-6">
        {STEPS.map(({ icon: Icon, tone, title, body }, i) => (
          <li key={title} className="card card-lift p-4">
            <div className="flex items-center justify-between">
              <span className={`grid h-9 w-9 place-items-center rounded-lg border ${tone}`}>
                <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-xs font-medium tabular-nums text-neutral-500">0{i + 1}</span>
            </div>
            <p className="mt-5 text-sm font-semibold text-neutral-900">{title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
