import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Check, Info, PackageOpen } from 'lucide-react';
import type { EscrowStatus, OrderView } from '@/lib/types';
import { formatUSD } from '@/lib/format';
import { orderAction, statusMeta, type Tone } from '@/lib/order-status';
import { UUID_RE } from '@/lib/uploads';
import OrderSupportButton from './OrderSupportButton';

const STEPS: { status: EscrowStatus; label: string }[] = [
  { status: 'funded', label: 'Paid to escrow' },
  { status: 'in_transit', label: 'In transit' },
  { status: 'customs_cleared', label: 'Customs cleared' },
  { status: 'delivered_pending_verification', label: 'Verify goods' },
  { status: 'released', label: 'Supplier paid' },
];
const ORDER: EscrowStatus[] = ['pending_payment', ...STEPS.map((s) => s.status)];

const TONE: Record<Tone, string> = {
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  escrow: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
  muted: 'border-neutral-200 bg-neutral-100 text-neutral-600',
};

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
          <li key={o.id} className={clsx('card relative p-5 transition-colors', linkable && 'hover:border-neutral-400 focus-within:border-neutral-400')}>
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
                <span className={clsx('pill whitespace-nowrap', TONE[status.tone])}>{status.label}</span>
              </div>
            </div>

            {note ? (
              <p className={clsx('mt-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
                note.danger ? 'border-red-200 bg-red-50 text-red-700' : 'border-neutral-200 bg-neutral-50 text-neutral-600')}>
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
                  return (
                    <li key={s.status} className="flex flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
                      <div className="flex w-full items-center">
                        <span className={clsx('h-px flex-1', i === 0 ? 'opacity-0' : done || current ? 'bg-neutral-900' : 'bg-neutral-200')} />
                        <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums',
                          done ? 'bg-neutral-900 text-white' : current ? 'bg-white text-neutral-900 ring-2 ring-neutral-900' : 'bg-neutral-100 text-neutral-400')}>
                          {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                        </span>
                        <span className={clsx('h-px flex-1', i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-neutral-900' : 'bg-neutral-200')} />
                      </div>
                      <span className={clsx('mt-2 px-0.5 text-[11px] leading-tight', done || current ? 'font-medium text-neutral-800' : 'text-neutral-400')}>{s.label}</span>
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
