'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Clock, Copy, FileDown, Landmark, Loader2, Upload, Wallet, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatUSD } from '@/lib/format';
import { formatRate } from '@/lib/pricing';
import {
  NETWORK_LABEL, PROOF_MAX_BYTES, cryptoFeeCents, normalizeTxHash, proofExt, proofPath,
  type CryptoOption, type ManualPaymentView, type SwiftDetails,
} from '@/lib/payment-methods';
import { cancelManualPayment, startManualPayment, submitManualPayment } from '@/app/dashboard/orders/[id]/payment-actions';

const BUCKET = 'payment-proofs';
/** Glass well for copyable bank / wallet details. */
const WELL = 'divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white/50 px-4 py-1 text-sm dark:divide-snow/[0.08] dark:border-snow/[0.08] dark:bg-snow/[0.03]';

function CopyValue({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-neutral-600">{label}</dt>
      <dd className={`flex min-w-0 items-center gap-1.5 text-right text-neutral-900 ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        <span className="break-all">{value}</span>
        <button type="button" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(value); toast.success(`${label} copied`); }}
          className="press shrink-0 rounded-lg p-1 text-neutral-500 hover:bg-neutral-900/[0.06] hover:text-neutral-900 dark:hover:bg-snow/10"><Copy className="h-3.5 w-3.5" aria-hidden /></button>
      </dd>
    </div>
  );
}

/** Receipt / screenshot dropzone: click to choose or drop a file (the input stays a real, labelled file input). */
function ProofDropzone({ id, file, onFile, prompt }: { id: string; file: File | null; onFile: (f: File | null) => void; prompt: string }) {
  const [over, setOver] = useState(false);
  return (
    <>
      <label htmlFor={id} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0] ?? null); }}
        className={`press-card flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-dashed px-4 py-7 text-center text-sm text-neutral-600 ${over
          ? 'border-blue-500 bg-blue-500/[0.06] text-neutral-900' : 'border-neutral-300 bg-white/40 hover:border-neutral-500 dark:border-snow/15 dark:bg-snow/[0.02] dark:hover:border-snow/30'}`}>
        <span className="grid h-9 w-9 place-items-center rounded-full border border-black/[0.06] bg-white/70 dark:border-snow/10 dark:bg-snow/[0.06]">
          {file ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <Upload className="h-4 w-4 text-neutral-500" aria-hidden />}
        </span>
        {file ? <span className="break-all font-medium text-neutral-900">{file.name}</span> : <span>{prompt}</span>}
        <span className="text-xs text-neutral-500">PDF, JPG or PNG · max 10 MB</span>
      </label>
      <input id={id} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </>
  );
}

/** Upload one file to payment-proofs/<buyer>/<payment>/<uuid>.<ext> (storage RLS: own folder). */
async function uploadProof(buyerId: string, paymentId: string, file: File): Promise<string> {
  const ext = proofExt(file.type);
  if (!ext) throw new Error('Upload a PDF, JPG or PNG.');
  if (file.size > PROOF_MAX_BYTES) throw new Error('Files must be under 10 MB.');
  const path = proofPath(buyerId, paymentId, crypto.randomUUID(), ext);
  const { error } = await createClient().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

function Submitted({ payment }: { payment: ManualPaymentView }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border p-4 text-sm tone-transit">
      <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">We&apos;re verifying your {payment.method === 'swift_wire' ? 'transfer' : 'deposit'} (reference {payment.reference})</p>
        <p className="mt-0.5">Our finance team confirms it as soon as it is credited — usually within 1–3 business days for wires and a few hours for crypto. This order updates automatically; there&apos;s no need to pay again.</p>
      </div>
    </div>
  );
}

function Rejected({ note }: { note: string | null }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border px-3 py-2 text-sm tone-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>We couldn&apos;t confirm your last transfer{note ? `: ${note}` : '.'} You can start a new one below or choose another method.</span>
    </p>
  );
}

/** SWIFT wire: escrow bank details + unique reference, PDF instructions, then the bank receipt. */
export function WireTransferPanel({ orderId, buyerId, dueCents, open, rejectedNote, swift }: {
  orderId: string; buyerId: string; dueCents: number; open: ManualPaymentView | null; rejectedNote: string | null; swift: SwiftDetails;
}) {
  const uid = useId();
  const router = useRouter();
  const [payment, setPayment] = useState<ManualPaymentView | null>(open?.method === 'swift_wire' ? open : null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (payment?.status === 'submitted') return <Submitted payment={payment} />;

  const begin = () => start(async () => {
    setError(null);
    const r = await startManualPayment(orderId, 'swift_wire', null);
    if (!r.ok) { setError(r.message); return; }
    setPayment(r.payment);
  });
  const submit = () => start(async () => {
    if (!payment || !file) return;
    setError(null);
    try {
      const path = await uploadProof(buyerId, payment.id, file);
      const r = await submitManualPayment(payment.id, null, path);
      if (!r.ok) { setError(r.message); return; }
      setPayment(r.payment);
      toast.success('Receipt received — we’ll confirm your transfer shortly.');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
  });
  const cancel = () => start(async () => {
    if (!payment) return;
    const r = await cancelManualPayment(payment.id);
    (r.ok ? toast.success : toast.error)(r.message);
    if (r.ok) setPayment(null);
  });

  if (!payment) {
    return (
      <div className="space-y-3">
        {rejectedNote !== null && <Rejected note={rejectedNote} />}
        <p className="text-sm text-neutral-600">
          Pay {formatUSD(dueCents, true)} by international bank transfer (SWIFT) to SokoGlobal&apos;s escrow account at {swift.bank_name}.
          Best for larger orders; transfers usually take 1–3 business days to arrive.
        </p>
        <button type="button" onClick={begin} disabled={pending} className="btn-primary w-full">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Landmark className="h-4 w-4" aria-hidden />} Get wire instructions
        </button>
        {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      </div>
    );
  }

  const b = payment.pay_to;
  return (
    <div className="space-y-4">
      <dl className={WELL}>
        <CopyValue label="Amount (USD)" value={(payment.charge_cents / 100).toFixed(2)} mono={false} />
        <CopyValue label="Payment reference" value={payment.reference} />
        <CopyValue label="Beneficiary" value={b.account_name ?? ''} mono={false} />
        <CopyValue label="Bank" value={b.bank_name ?? ''} mono={false} />
        <CopyValue label="SWIFT / BIC" value={b.swift_code ?? ''} />
        <CopyValue label="Account / IBAN" value={b.account_number ?? ''} />
        {b.routing_number && <CopyValue label="Routing / sort code" value={b.routing_number} />}
        {b.bank_address && <CopyValue label="Bank address" value={b.bank_address} mono={false} />}
      </dl>
      <p className="text-xs text-neutral-600">
        Put <strong className="font-mono">{payment.reference}</strong> in the payment details and choose “charges paid by sender (OUR)” so the full amount arrives.
      </p>
      <a href={`/api/orders/${orderId}/wire-invoice`} className="btn-secondary w-full py-2 text-sm"><FileDown className="h-4 w-4" aria-hidden /> Download payment instructions (PDF)</a>

      <div className="border-t border-black/[0.06] pt-4 dark:border-snow/[0.08]">
        <p className="label">After sending: upload the bank&apos;s transfer confirmation</p>
        <ProofDropzone id={`${uid}-proof`} file={file} onFile={setFile} prompt="Drop the bank receipt here, or click to choose" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={submit} disabled={pending || !file} className="btn-primary flex-1">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} I&apos;ve sent the transfer
          </button>
          <button type="button" onClick={cancel} disabled={pending} className="btn-secondary"><X className="h-4 w-4" aria-hidden /> Cancel</button>
        </div>
        {error && <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      </div>
    </div>
  );
}

/** Crypto escrow: pick asset + network, send to the official wallet, then submit the transaction hash. */
export function CryptoPanel({ orderId, buyerId, dueCents, open, rejectedNote, options, markup }: {
  orderId: string; buyerId: string; dueCents: number; open: ManualPaymentView | null; rejectedNote: string | null;
  options: CryptoOption[]; markup: number;
}) {
  const uid = useId();
  const router = useRouter();
  const [payment, setPayment] = useState<ManualPaymentView | null>(open && open.method !== 'swift_wire' ? open : null);
  const [choice, setChoice] = useState(0);
  const [hash, setHash] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (payment?.status === 'submitted') return <Submitted payment={payment} />;
  const fee = cryptoFeeCents(dueCents, markup);

  const begin = () => start(async () => {
    setError(null);
    const o = options[choice];
    const r = await startManualPayment(orderId, o.method, o.network);
    if (!r.ok) { setError(r.message); return; }
    setPayment(r.payment);
  });
  const submit = () => start(async () => {
    if (!payment?.network) return;
    setError(null);
    if (!normalizeTxHash(payment.network, hash)) {
      setError(payment.network === 'trc20' ? 'Enter the TRON transaction hash (64 hex characters).' : 'Enter the transaction hash: 0x followed by 64 hex characters.');
      return;
    }
    try {
      const path = file ? await uploadProof(buyerId, payment.id, file) : null;
      const r = await submitManualPayment(payment.id, hash, path);
      if (!r.ok) { setError(r.message); return; }
      setPayment(r.payment);
      toast.success('Transaction received — we’ll confirm it on the blockchain shortly.');
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); }
  });
  const cancel = () => start(async () => {
    if (!payment) return;
    const r = await cancelManualPayment(payment.id);
    (r.ok ? toast.success : toast.error)(r.message);
    if (r.ok) setPayment(null);
  });

  if (!payment) {
    return (
      <div className="space-y-3">
        {rejectedNote !== null && <Rejected note={rejectedNote} />}
        <fieldset>
          <legend className="label">Pay with</legend>
          <div className="space-y-2">
            {options.map((o, i) => (
              <label key={o.wallet} className="press-card flex cursor-pointer items-center gap-3 rounded-xl border border-black/[0.08] bg-white/40 p-3 text-sm hover:border-neutral-400 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-500/[0.06] dark:border-snow/10 dark:bg-snow/[0.02] dark:hover:border-snow/25 dark:has-[:checked]:border-cyan-400/60">
                <input type="radio" name={`${uid}-coin`} checked={choice === i} onChange={() => setChoice(i)} /> {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <dl className="space-y-1 text-sm text-neutral-600">
          <div className="flex justify-between"><dt>Escrow amount</dt><dd className="tabular-nums text-neutral-900">{formatUSD(dueCents, true)}</dd></div>
          <div className="flex justify-between"><dt>Crypto handling fee ({formatRate(markup)})</dt><dd className="tabular-nums text-neutral-900">{formatUSD(fee, true)}</dd></div>
          <div className="flex justify-between border-t border-neutral-200 pt-1 font-medium text-neutral-900"><dt>You send</dt><dd className="tabular-nums">{((dueCents + fee) / 100).toFixed(2)} {options[choice]?.method === 'crypto_usdc' ? 'USDC' : 'USDT'}</dd></div>
        </dl>
        <button type="button" onClick={begin} disabled={pending || !options.length} className="btn-primary w-full">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4" aria-hidden />} Show deposit address
        </button>
        {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      </div>
    );
  }

  const asset = payment.pay_to.asset ?? (payment.method === 'crypto_usdc' ? 'USDC' : 'USDT');
  return (
    <div className="space-y-4">
      <p role="note" className="rounded-xl border px-3 py-2 text-xs tone-pending">
        Send only <strong>{asset}</strong> on the <strong>{payment.network ? NETWORK_LABEL[payment.network] : ''}</strong> network to this address. Other coins or networks can&apos;t be recovered.
      </p>
      <dl className={WELL}>
        <CopyValue label={`Amount (${asset})`} value={(payment.charge_cents / 100).toFixed(2)} mono={false} />
        <CopyValue label="Deposit address" value={payment.pay_to.address ?? ''} />
        <CopyValue label="Reference (keep for support)" value={payment.reference} />
      </dl>
      <div className="border-t border-black/[0.06] pt-4 dark:border-snow/[0.08]">
        <label htmlFor={`${uid}-hash`} className="label">After sending: transaction hash (txHash)</label>
        <input id={`${uid}-hash`} value={hash} onChange={(e) => setHash(e.target.value)} spellCheck={false} autoComplete="off"
          placeholder={payment.network === 'trc20' ? '64 hex characters' : '0x…'} className="input font-mono text-xs" />
        <p className="label mt-3">Screenshot <span className="font-normal normal-case tracking-normal text-neutral-500">(optional)</span></p>
        <ProofDropzone id={`${uid}-shot`} file={file} onFile={setFile} prompt="Drop a wallet screenshot here, or click to choose" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={submit} disabled={pending || !hash.trim()} className="btn-primary flex-1">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} I&apos;ve sent it
          </button>
          <button type="button" onClick={cancel} disabled={pending} className="btn-secondary"><X className="h-4 w-4" aria-hidden /> Cancel</button>
        </div>
        {error && <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
      </div>
    </div>
  );
}
