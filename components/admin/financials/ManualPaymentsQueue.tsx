'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, ExternalLink, FileText, Loader2, X } from 'lucide-react';
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
    <li className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-neutral-900">
          {MANUAL_METHOD_LABEL[r.method]}{r.network ? ` · ${NETWORK_LABEL[r.network]}` : ''} · <span className="tabular-nums">{formatUSD(r.charge_cents, true)}</span>
          {r.leg && <span className="ml-1 text-xs font-normal text-neutral-500">({r.leg === 'deposit' ? '30% deposit' : '70% balance'})</span>}
        </p>
        <p className="mt-0.5 text-neutral-600">
          {r.buyer} · <Link href={`/admin/control?order=${r.order_id}`} className="font-mono text-xs text-blue-700 hover:underline dark:text-cyan-300">#{r.order_id.slice(0, 8).toUpperCase()}</Link>
          {r.product_title ? ` · ${r.product_title}` : ''}
        </p>
        <p className="mt-1 font-mono text-xs text-neutral-700">Ref {r.reference}{r.fee_cents ? ` · escrow ${formatUSD(r.usd_cents, true)} + fee ${formatUSD(r.fee_cents, true)}` : ''}</p>
        {r.tx_hash && r.network && (
          <a href={explorerUrl(r.network, r.tx_hash)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-xs text-blue-700 hover:underline dark:text-cyan-300">
            {r.tx_hash} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        )}
        {r.proof_url && (
          <a href={r.proof_url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-cyan-300">
            <FileText className="h-3.5 w-3.5" aria-hidden /> View {r.method === 'swift_wire' ? 'bank receipt' : 'screenshot'} (link valid 10 min)
          </a>
        )}
        {r.submitted_at && <p className="mt-1 text-xs text-neutral-500">Submitted {new Date(r.submitted_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor={`recv-${r.id}`} className="label text-xs">Amount that arrived (USD)</label>
            <input id={`recv-${r.id}`} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className="input py-1.5 tabular-nums" disabled={pending} />
          </div>
        </div>
        <label htmlFor={`note-${r.id}`} className="label text-xs">Note (required to reject; shown to the buyer)</label>
        <input id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="input py-1.5 text-sm" disabled={pending} />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => run(() => approveManualPayment(r.id, received, note))} className="btn-primary flex-1 py-1.5 text-sm">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve → escrow
          </button>
          <button type="button" disabled={pending || note.trim().length < 5} onClick={() => run(() => rejectManualPayment(r.id, note))} className="btn-secondary py-1.5 text-sm">
            <X className="h-4 w-4" aria-hidden /> Reject
          </button>
        </div>
      </div>
    </li>
  );
}

/** Wire receipts and crypto transaction hashes waiting for a super admin to confirm the money arrived. */
export default function ManualPaymentsQueue({ rows, moneyBlocked }: { rows: QueueRow[]; moneyBlocked: string | null }) {
  if (!rows.length) return <p className="card px-5 py-8 text-center text-sm text-neutral-600">No wire or crypto payments are waiting for review.</p>;
  return (
    <div className="card overflow-hidden">
      {moneyBlocked && <p role="note" className="border-b border-neutral-200 px-4 py-3 text-sm tone-pending">{moneyBlocked} Approving or rejecting needs it.</p>}
      <p className="border-b border-neutral-200 px-4 py-2 text-xs text-neutral-600">
        Approve only after the money is visible in the escrow bank account or on the blockchain (check the amount, the reference and the receiving address).
        Approval moves the order into escrow and notifies the buyer and supplier.
      </p>
      <ul className="divide-y divide-neutral-200">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
    </div>
  );
}
