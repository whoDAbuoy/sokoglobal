import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { barHeights, filledDots, formatChange } from '@/lib/admin-metrics';

/** Panel surface for the admin dashboard; flips with the `.dark` neutral scale. */
export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={clsx('card p-5', className)}>{children}</section>;
}

/** Change badge, e.g. "+18.2% than last week". `goodWhenUp=false` for metrics where growth is bad (disputes). */
export function ChangeBadge({ change, current, goodWhenUp = true, suffix = 'than last week' }: {
  change: number | null; current: number; goodWhenUp?: boolean; suffix?: string;
}) {
  const text = formatChange(change, current);
  const positive = change !== null && change > 0;
  const negative = change !== null && change < 0;
  const good = goodWhenUp ? positive : negative;
  const bad = goodWhenUp ? negative : positive;
  return (
    <p className="mt-1 text-xs text-neutral-500">
      <span className={clsx('font-semibold tabular-nums', good && 'text-emerald-700', bad && 'text-red-700', !good && !bad && 'text-neutral-700')}>{text}</span>{' '}
      {suffix}
    </p>
  );
}

export function KpiCard({ icon: Icon, value, label, children }: {
  icon: LucideIcon; value: string | number; label: string; children?: React.ReactNode;
}) {
  return (
    <Panel className="card-lift p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-neutral-200 bg-neutral-50">
          <Icon className="h-4 w-4 text-neutral-700" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-neutral-900">{label}</p>
      {children}
    </Panel>
  );
}

/** Minimal inline bar chart (values are relative). */
export function MiniBars({ values, labels, muted = false, title }: {
  values: number[]; labels?: string[]; muted?: boolean; title: string;
}) {
  const heights = barHeights(values);
  return (
    <div role="img" aria-label={`${title}: ${values.map((v, i) => `${labels?.[i] ?? i + 1} ${v}`).join(', ')}`}
      className="flex h-10 items-end gap-1">
      {heights.map((h, i) => (
        <span key={i} title={`${labels?.[i] ?? ''} ${values[i]}`.trim()}
          className={clsx('w-2.5 rounded-sm transition-[height] duration-700 ease-out', muted ? 'bg-neutral-300' : 'bg-neutral-900')}
          style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function MiniStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-200">
        <Icon className="h-4 w-4 text-neutral-700" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-neutral-500">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</p>
      </div>
    </div>
  );
}

/** Share bar (0–100). */
export function ShareBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-full rounded-full bg-neutral-900 transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/** Row of pill dots, filled up to `pct`. */
export function CohortDots({ pct, total = 24, label }: { pct: number; total?: number; label: string }) {
  const filled = filledDots(pct, total);
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} className="flex flex-wrap gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={clsx('h-5 w-3 rounded-full transition-colors', i < filled ? 'bg-neutral-900' : 'bg-neutral-200')} />
      ))}
    </div>
  );
}
