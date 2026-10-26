import clsx from 'clsx';
import { Check, ClipboardList, ExternalLink, PackageCheck, Truck, Wallet, type LucideIcon } from 'lucide-react';
import type { TimelineKey, TimelineStep } from '@/lib/shipping';

const ICON: Record<TimelineKey, LucideIcon> = { placed: ClipboardList, escrowed: Wallet, dispatched: Truck, delivered: PackageCheck };
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' }) : null;

/** Order Placed → Payment Escrowed → Dispatched → Delivered, with the carrier's tracking link once there is one. */
export default function OrderTimeline({ steps, trackingUrl, className }: { steps: TimelineStep[]; trackingUrl: string | null; className?: string }) {
  return (
    <section aria-labelledby="timeline-title" className={clsx('card p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-title" className="eyebrow">Order tracking</h2>
        {trackingUrl && (
          <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary px-3 py-1.5 text-sm">
            Track with carrier <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
      <ol className="mt-5 grid gap-4 sm:grid-cols-4 sm:gap-2">
        {steps.map((s, i) => {
          const Icon = ICON[s.key];
          return (
            <li key={s.key} className="relative flex gap-3 sm:flex-col sm:items-center sm:text-center" aria-current={s.state === 'current' ? 'step' : undefined}>
              {/* Connector to the next step (vertical on phones, horizontal from sm). */}
              {i < steps.length - 1 && (
                <span aria-hidden className={clsx('absolute left-4 top-9 h-[calc(100%-1.25rem)] w-0.5 sm:left-[calc(50%+1.25rem)] sm:top-4 sm:h-0.5 sm:w-[calc(100%-2.5rem)]',
                  s.state === 'done' && steps[i + 1].state !== 'upcoming' ? 'bg-gradient-to-r from-[#5a9895] to-teal-400' : 'bg-neutral-200')} />
              )}
              <span className={clsx('relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full',
                s.state === 'done' ? 'bg-[#5a9895] text-snow' : s.state === 'current' ? 'bg-teal-400/15 text-teal-700 ring-2 ring-teal-400 dark:text-[#8fd3cc]' : 'bg-neutral-100 text-neutral-400')}>
                {s.state === 'done' ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
                <span className="sr-only">{s.state === 'done' ? 'Done: ' : s.state === 'current' ? 'Current: ' : 'Upcoming: '}</span>
              </span>
              <span className="min-w-0 pb-1 sm:mt-2">
                <span className={clsx('block text-sm', s.state === 'upcoming' ? 'text-neutral-500' : 'font-medium text-neutral-900')}>{s.label}</span>
                {s.state === 'done' && when(s.at) && <span className="block text-xs text-neutral-500">{when(s.at)}</span>}
                {s.detail && <span className="block break-words text-xs text-neutral-600">{s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
