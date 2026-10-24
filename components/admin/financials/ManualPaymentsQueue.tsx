'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, ExternalLink, FileText, Inbox, Landmark, Loader2, Wallet, X } from 'lucide-react';
import { approveManualPayment, rejectManualPayment } from '@/app/admin/financials/actions';
import { formatUSD } from '@/lib/format';
import { MANUAL_METHOD_LABEL, NETWORK_LABEL, explorerUrl, type CryptoNetwork } from '@/lib/payment-methods';

export interface QueueRow {
  id: string; method: 'swift_wire' | 'crypto_usdt' | 'crypto_usdc'; network: CryptoNetwork | null; leg: string | null;
  usd_cents: number; fee_cents: number; charge_cents: number; reference: string; tx_hash: string | null;
  submitted_at: string | null; order_id: string; product_title: string | null; buyer: string; proof_url: string | null;
}

function Row({ r }: { r: QueueRow }) {
  const router = useRouter();
  const [received, setReceived] = useState((r.charge_cents / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    const res = await fn();
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) router.refresh();
  });

  return (
    <li className="glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className={`pill text-[11px] ${r.method === 'swift_wire' ? 'tone-active' : 'tone-transit'}`}>
              {r.method === 'swift_wire' ? <Landmark className="h-3 w-3" aria-hidden /> : <Wallet className="h-3 w-3" aria-hidden />}
              {MANUAL_METHOD_LABEL[r.method]}
            </span>
            {r.network && <span className="text-xs text-neutral-500">{NETWORK_LABEL[r.network]}</span>}
            {r.leg && <span className="pill tone-muted text-[11px]">{r.leg === 'deposit' ? '30% deposit' : '70% balance'}</span>}
          </p>
          <p className="mt-2 text-sm text-neutral-900">
            {r.buyer} · <Link href={`/admin/control?order=${r.order_id}`} className="font-mono text-xs text-blue-700 hover:underline dark:text-cyan-300">#{r.order_id.slice(0, 8).toUpperCase()}</Link>
          </p>
          {r.product_title && <p className="line-clamp-1 text-xs text-neutral-600">{r.product_title}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums text-neutral-900">{formatUSD(r.charge_cents, true)}</p>
          {r.submitted_at && <p className="text-xs tabular-nums text-neutral-500">{new Date(r.submitted_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        </div>
      </div>

      <dl className="glass-inset mt-4 divide-y divide-black/[0.06] px-4 py-1 text-xs dark:divide-snow/[0.08]">
        <div className="flex justify-between gap-3 py-2"><dt className="text-neutral-500">Reference</dt><dd className="font-mono text-neutral-900">{r.reference}</dd></div>
        {r.fee_cents > 0 && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-neutral-500">Breakdown</dt>
            <dd className="font-mono tabular-nums text-neutral-900">escrow {formatUSD(r.usd_cents, true)} + fee {formatUSD(r.fee_cents, true)}</dd>
          </div>
        )}
        {r.tx_hash && r.network && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="shrink-0 text-neutral-500">Transaction</dt>
            <dd className="min-w-0 text-right">
              <a href={explorerUrl(r.network, r.tx_hash)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1 break-all font-mono text-blue-700 hover:underline dark:text-cyan-300">
                {r.tx_hash} <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              </a>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-neutral-500">{r.method === 'swift_wire' ? 'Bank receipt' : 'Screenshot'}</dt>
          <dd>
            {r.proof_url
              ? <a href={r.proof_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-cyan-300"><FileText className="h-3.5 w-3.5" aria-hidden /> View (link valid 10 min)</a>
              : <span className="text-neutral-500">Not attached</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`recv-${r.id}`} className="label text-[11px]">Amount that arrived (USD)</label>
          <input id={`recv-${r.id}`} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className="input py-1.5 tabular-nums" disabled={pending} />
        </div>
        <div>
          <label htmlFor={`note-${r.id}`} className="label text-[11px]">Note (required to reject; shown to the buyer)</label>
          <input id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="input py-1.5 text-sm" disabled={pending} />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => approveManualPayment(r.id, received, note))} className="btn-primary flex-1 rounded-full py-2 text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve → escrow
        </button>
        <button type="button" disabled={pending || note.trim().length < 5} onClick={() => run(() => rejectManualPayment(r.id, note))} className="btn-secondary rounded-full py-2 text-sm">
          <X className="h-4 w-4" aria-hidden /> Reject
        </button>
      </div>
    </li>
  );
}

/** Wire receipts and crypto transaction hashes waiting for a super admin to confirm the money arrived. */
export default function ManualPaymentsQueue({ rows, moneyBlocked }: { rows: QueueRow[]; moneyBlocked: string | null }) {
  if (!rows.length) {
    return (
      <div className="glass-card px-5 py-10 text-center">
        <Inbox className="mx-auto h-6 w-6 text-neutral-400" aria-hidden />
        <p className="mt-2 text-sm text-neutral-600">No wire or crypto payments are waiting for review.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {moneyBlocked && <p role="note" className="rounded-2xl border px-4 py-3 text-sm tone-pending">{moneyBlocked} Approving or rejecting needs it.</p>}
      <p className="text-xs text-neutral-600">
        Approve only after the money is visible in the escrow bank account or on the blockchain (check the amount, the reference and the receiving address).
        Approval moves the order into escrow and notifies the buyer and supplier.
      </p>
      <ul aria-label="Payments waiting for review, oldest first" className="grid gap-4 xl:grid-cols-2">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
    </div>
  );
}
