import clsx from 'clsx';
import { AlertTriangle, Check, PackageOpen } from 'lucide-react';
import type { EscrowStatus, OrderView } from '@/lib/types';
import { formatUSD } from '@/lib/format';

const STEPS: { status: EscrowStatus; label: string }[] = [
  { status: 'funded', label: 'Paid to escrow' },
  { status: 'in_transit', label: 'In transit' },
  { status: 'customs_cleared', label: 'Customs cleared' },
  { status: 'delivered_pending_verification', label: 'Verify goods' },
  { status: 'released', label: 'Supplier paid' },
];
const ORDER: EscrowStatus[] = ['pending_payment', ...STEPS.map((s) => s.status)];

export default function EscrowTracker({ orders }: { orders: OrderView[] }) {
  if (!orders.length) {
    return (
      <div className="card flex flex-col items-center px-6 py-10 text-center">
        <PackageOpen className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-900">No orders yet</p>
        <p className="mt-1 text-sm text-slate-500">Start a $500 Trial Batch to test a supplier risk-free.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((o) => {
        const idx = ORDER.indexOf(o.escrow_status);
        const exceptional = o.escrow_status === 'disputed' || o.escrow_status === 'refunded' || o.escrow_status === 'cancelled';
        return (
          <li key={o.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{o.product_title}</p>
                <p className="text-xs text-slate-500">
                  {o.order_type === 'trial' ? 'Trial Batch' : o.order_type === 'pool' ? 'Trend Pool' : 'Order'} ·{' '}
                  {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · #{o.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <p className="text-right">
                <span className="block text-sm font-semibold tabular-nums">{formatUSD(o.total_cents, true)}</span>
                <span className={clsx('text-xs', o.escrow_status === 'pending_payment' ? 'text-amber-700' : 'text-emerald-700')}>
                  {o.escrow_status === 'pending_payment' ? 'Awaiting payment'
                    : o.escrow_status === 'released' ? 'Released to supplier'
                    : o.escrow_status === 'refunded' ? 'Refunded to you'
                    : 'Held in escrow'}
                </span>
              </p>
            </div>

            {exceptional ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" /> {o.escrow_status === 'disputed' ? 'Dispute open — funds frozen while we investigate.' : `Order ${o.escrow_status}.`}
              </p>
            ) : (
              <ol className="mt-5 grid grid-cols-5 gap-1">
                {STEPS.map((s, i) => {
                  const done = idx >= i + 1;
                  const current = idx === i; // the next step is in progress
                  return (
                    <li key={s.status} className="flex flex-col items-center text-center">
                      <div className="flex w-full items-center">
                        <span className={clsx('h-0.5 flex-1', i === 0 ? 'opacity-0' : done || current ? 'bg-brand-700' : 'bg-slate-200')} />
                        <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                          done ? 'bg-brand-700 text-white' : current ? 'bg-white text-brand-700 ring-2 ring-brand-700' : 'bg-slate-100 text-slate-400')}>
                          {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                        </span>
                        <span className={clsx('h-0.5 flex-1', i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-brand-700' : 'bg-slate-200')} />
                      </div>
                      <span className={clsx('mt-1.5 text-[11px] leading-tight', done || current ? 'font-medium text-slate-800' : 'text-slate-400')}>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ul>
  );
}
