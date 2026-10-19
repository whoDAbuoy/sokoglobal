import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, BadgeDollarSign, Check, ClipboardCheck, Info, PackageCheck, PackageOpen, Plane, Wallet, type LucideIcon } from 'lucide-react';
import type { EscrowStatus, OrderView } from '@/lib/types';
import { formatUSD } from '@/lib/format';
import { orderAction, statusMeta, type Tone } from '@/lib/order-status';
import { UUID_RE } from '@/lib/uploads';
import OrderSupportButton from './OrderSupportButton';

const STEPS: { status: EscrowStatus; label: string; icon: LucideIcon }[] = [
  { status: 'funded', label: 'Paid to escrow', icon: Wallet },
  { status: 'in_transit', label: 'In transit', icon: Plane },
  { status: 'customs_cleared', label: 'Customs cleared', icon: ClipboardCheck },
  { status: 'delivered_pending_verification', label: 'Verify goods', icon: PackageCheck },
  { status: 'released', label: 'Supplier paid', icon: BadgeDollarSign },
];
const ORDER: EscrowStatus[] = ['pending_payment', ...STEPS.map((s) => s.status)];

const TONE: Record<Tone, string> = {
  warning: 'tone-pending',
  escrow: 'tone-escrow',
  success: 'tone-escrow',
  danger: 'tone-danger',
  muted: 'tone-muted',
};
/** Shipments on the move read as cyan "in transit" rather than plain escrow green. */
const pillTone = (status: EscrowStatus, tone: Tone) =>
  status === 'in_transit' || status === 'customs_cleared' ? 'tone-transit' : TONE[tone];

const EXCEPTION_NOTE: Partial<Record<EscrowStatus, { icon: typeof Info; text: string; danger?: boolean }>> = {
  disputed: { icon: AlertTriangle, text: 'Dispute open — funds stay frozen in escrow while we investigate.', danger: true },
  refunded: { icon: Info, text: 'Refunded to your original payment method.' },
  cancelled: { icon: Info, text: 'This order was cancelled.' },
};

/**
 * Order cards with escrow milestones. Each card links to its order page
 * (payment, tracking, verification — cart orders continue to their checkout)
 * and shows one next step; closed or disputed orders open the support chat.
 * `actions={false}` hides the step button (used on the order page itself).
 */
export default function EscrowTracker({ orders, actions = true }: { orders: OrderView[]; actions?: boolean }) {
  if (!orders.length) {
    return (
      <div className="card flex flex-col items-center px-6 py-10 text-center">
        <PackageOpen className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
        <p className="mt-3 text-sm font-medium text-neutral-900">No orders yet</p>
        <p className="mt-1 text-sm text-neutral-500">Start a $500 Trial Batch to test a supplier risk-free.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((o) => {
        const idx = ORDER.indexOf(o.escrow_status);
        const note = EXCEPTION_NOTE[o.escrow_status];
        const status = statusMeta(o.escrow_status);
        const action = orderAction(o);
        const linkable = actions && UUID_RE.test(o.id);
        return (
          <li key={o.id} className={clsx('card relative p-5 transition-colors', linkable && 'card-lift hover:border-blue-500/40 focus-within:border-blue-500/40')}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900">
                  {linkable ? (
                    // Stretched link: the whole card opens the order page.
                    <Link href={`/dashboard/orders/${o.id}`} className="after:absolute after:inset-0 after:rounded-lg focus:outline-none focus-visible:underline">
                      {o.product_title}
                    </Link>
                  ) : o.product_title}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {o.order_type === 'trial' ? 'Trial Batch' : o.order_type === 'pool' ? 'Trend Pool' : 'Order'}
                  <span aria-hidden> · </span>
                  {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  <span aria-hidden> · </span>
                  <span className="font-mono">#{o.id.slice(0, 8).toUpperCase()}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="whitespace-nowrap text-base font-semibold tabular-nums text-neutral-900">{formatUSD(o.total_cents, true)}</span>
                <span className={clsx('pill whitespace-nowrap', pillTone(o.escrow_status, status.tone))}>{status.label}</span>
              </div>
            </div>

            {note ? (
              <p className={clsx('mt-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
                note.danger ? 'tone-danger' : 'border-neutral-200 bg-neutral-50 text-neutral-600')}>
                <note.icon className="mt-0.5 h-4 w-4 shrink-0" /> {note.text}
              </p>
            ) : (
              <ol className="mt-5 grid grid-cols-5" aria-label="Escrow milestones">
                {STEPS.map((s, i) => {
                  // The step in progress is the next milestone — except when delivered: then the buyer
                  // still has to verify, so "Verify goods" is current until the order is released.
                  const currentIdx = o.escrow_status === 'delivered_pending_verification' ? 3 : idx;
                  const done = i < currentIdx;
                  const current = i === currentIdx;
                  const Icon = s.icon;
                  return (
                    <li key={s.status} className="flex flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
                      <div className="flex w-full items-center">
                        <span className={clsx('h-0.5 flex-1 rounded-full', i === 0 ? 'opacity-0' : done || current ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-neutral-200')} />
                        <span className={clsx('relative grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors',
                          done ? 'bg-emerald-500 text-snow shadow-[0_0_14px_-2px_rgb(16_185_129/0.7)]'
                            : current ? 'bg-cyan-500/15 text-cyan-600 ring-2 ring-cyan-500 dark:text-cyan-400'
                            : 'bg-neutral-100 text-neutral-400')}>
                          {current && <span className="absolute inset-0 rounded-full border-2 border-cyan-400 motion-safe:animate-pulse-ring" aria-hidden />}
                          {done ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> : <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />}
                          <span className="sr-only">{done ? 'Done: ' : current ? 'Current: ' : 'Upcoming: '}</span>
                        </span>
                        <span className={clsx('h-0.5 flex-1 rounded-full', i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-neutral-200')} />
                      </div>
                      <span className={clsx('mt-2 px-0.5 text-[11px] leading-tight', done ? 'font-medium text-neutral-800' : current ? 'font-semibold text-cyan-700 dark:text-cyan-400' : 'text-neutral-400')}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {actions && action.kind !== 'none' && (
              <div className="relative z-10 mt-5 flex justify-end border-t border-neutral-200 pt-4">
                {action.kind === 'link' ? (
                  <Link href={action.href} className={clsx(action.primary ? 'btn-primary' : 'btn-secondary', 'px-3.5 py-2')}>
                    {action.label} <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <OrderSupportButton orderId={action.orderId} label={action.label} />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
