'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Loader2, ShieldAlert, Truck } from 'lucide-react';
import { forceRelease, overrideLandedCost, refundOrder, setTrackingReference, startPayout, type ControlResult } from '@/app/admin/control/actions';
import { isHeld } from '@/lib/admin-overrides';
import { formatUSD } from '@/lib/format';

export interface OverrideOrder {
  id: string; escrow_status: string; total_cents: number; goods_cents: number; freight_cents: number; customs_cents: number;
  checkout_group_id: string | null; tracking_number: string | null; carrier: string | null; has_payout: boolean;
}

type Tool = 'release' | 'refund' | 'payout' | 'tracking' | 'landed';

/**
 * Super admin order tools. Each one needs a reason, runs as an audited
 * super_* SQL function, and asks for confirmation before moving money.
 */
export default function OrderOverrides({ order }: { order: OverrideOrder }) {
  const router = useRouter();
  const held = isHeld(order.escrow_status);
  const tools: [Tool, string, boolean][] = [
    ['release', 'Force release', held],
    ['refund', 'Refund', held],
    ['payout', 'Start payout', order.escrow_status === 'released'],
    ['tracking', 'Tracking number', true],
    ['landed', 'Landed cost', order.escrow_status === 'pending_payment' && !order.checkout_group_id],
  ];
  const available = tools.filter(([, , ok]) => ok);
  const [tool, setTool] = useState<Tool>(available[0]?.[0] ?? 'tracking');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [goods, setGoods] = useState((order.goods_cents / 100).toFixed(2));
  const [freight, setFreight] = useState((order.freight_cents / 100).toFixed(2));
  const [customs, setCustoms] = useState((order.customs_cents / 100).toFixed(2));
  const [result, setResult] = useState<ControlResult | null>(null);
  const [pending, start] = useTransition();

  const confirmText: Partial<Record<Tool, string>> = {
    release: `Release ${formatUSD(order.goods_cents, true)} of goods value to the supplier now, without the buyer's confirmation?`,
    refund: mode === 'full' ? `Refund the full ${formatUSD(order.total_cents, true)} to the buyer and close the order?` : `Refund $${amount || '0'} to the buyer?`,
    payout: 'Start the supplier payout for this released order?',
  };

  const run = () => start(async () => {
    const text = confirmText[tool];
    if (text && !window.confirm(text)) return;
    const res = tool === 'release' ? await forceRelease(order.id, reason)
      : tool === 'refund' ? await refundOrder(order.id, mode, amount, reason)
      : tool === 'payout' ? await startPayout(order.id, reason)
      : tool === 'tracking' ? await setTrackingReference(order.id, tracking, carrier, reason)
      : await overrideLandedCost(order.id, goods, freight, customs, reason);
    setResult(res);
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) { setReason(''); router.refresh(); }
  });

  return (
    <div>
      <div role="tablist" aria-label="Override tools" className="flex flex-wrap gap-1.5">
        {tools.map(([key, label, ok]) => (
          <button key={key} type="button" role="tab" aria-selected={tool === key} disabled={!ok} onClick={() => { setTool(key); setResult(null); }}
            className={clsx('press rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              tool === key ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-800 hover:border-neutral-900')}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-4 space-y-3">
        {tool === 'release' && (
          <p className="text-sm text-neutral-700">Marks escrow <strong>released</strong> and starts the normal supplier payout (KYC and payout account checks still apply).</p>
        )}
        {tool === 'refund' && (
          <>
            <fieldset className="flex gap-4 text-sm">
              <legend className="sr-only">Refund type</legend>
              {(['full', 'partial'] as const).map((m) => (
                <label key={m} className="inline-flex items-center gap-2 text-neutral-800">
                  <input type="radio" name={`mode-${order.id}`} checked={mode === m} onChange={() => setMode(m)} /> {m === 'full' ? `Full (${formatUSD(order.total_cents, true)})` : 'Partial'}
                </label>
              ))}
            </fieldset>
            {mode === 'partial' && (
              <div>
                <label htmlFor="refund-amount" className="label">Amount (USD)</label>
                <input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input max-w-40 tabular-nums" placeholder="0.00" />
              </div>
            )}
            <p className="text-xs text-neutral-600">Card payments are refunded through Paystack. M-Pesa payments are recorded as <em>manual required</em> for finance to send.</p>
          </>
        )}
        {tool === 'payout' && <p className="text-sm text-neutral-700">{order.has_payout ? 'A payout row exists; this retries it if it failed or is on hold. Payouts in flight are never sent twice.' : 'No payout yet. This starts one now.'}</p>}
        {tool === 'tracking' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="trk" className="label">Tracking / B/L number</label><input id="trk" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={80} className="input" /></div>
            <div><label htmlFor="car" className="label">Carrier</label><input id="car" value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={80} className="input" placeholder="e.g. Maersk, DHL" /></div>
            <Link href={`/admin/orders/${order.id}/tracking`} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-cyan-300 sm:col-span-2">
              <Truck className="h-3.5 w-3.5" aria-hidden /> Shipment status, milestones and ETA live on the tracking page
            </Link>
          </div>
        )}
        {tool === 'landed' && (
          <div className="grid gap-3 sm:grid-cols-3">
            {([['Goods', goods, setGoods], ['Freight', freight, setFreight], ['Customs', customs, setCustoms]] as const).map(([label, v, set]) => (
              <div key={label}><label htmlFor={`lc-${label}`} className="label">{label} (USD)</label>
                <input id={`lc-${label}`} inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} className="input tabular-nums" /></div>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="ovr-reason" className="label">Reason (written to the audit log)</label>
          <textarea id="ovr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} className="input" />
        </div>
        {result && <p role="status" className={clsx('text-sm', result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>{result.message}</p>}
        <button type="button" onClick={run} disabled={pending || reason.trim().length < 5 || available.length === 0}
          className={clsx('btn-primary px-4 py-2', (tool === 'release' || tool === 'refund') && 'bg-rose-600 hover:bg-rose-500')}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />} Apply override
        </button>
      </div>
    </div>
  );
}
