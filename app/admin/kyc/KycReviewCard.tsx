'use client';

import { useActionState, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle, BadgeCheck, CheckCircle2, Eye, EyeOff, FileText, IdCard, Landmark, Loader2, Receipt, Undo2,
} from 'lucide-react';
import { approveKyc, rejectKyc, revealPayoutAccount, type KycActionState } from './actions';
import { countryName, flag, formatUSD } from '@/lib/format';

export interface KycCase {
  supplierId: string;
  legalName: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  address: string | null;
  submittedAt: string | null;
  reviewNotes: string | null;
  supplier: { company_name: string; full_name: string; country_code: string; created_at: string } | null;
  documents: { id: string; docType: string; fileName: string; mimeType: string; bytes: number; uploadedAt: string; url: string | null }[];
  account: {
    method: string; country_code: string; currency: string; bank_code: string; bank_name: string | null;
    account_last4: string | null; beneficiary_name: string; international: Record<string, string>; verified: boolean; updated_at: string;
  } | null;
  heldPayouts: { count: number; cents: number };
  duplicateAccounts: number;
}

const DOC_META: Record<string, { label: string; icon: typeof FileText }> = {
  tax_certificate: { label: 'Tax ID certificate', icon: Receipt },
  business_registration: { label: 'Business registration', icon: FileText },
  identity: { label: 'Director identity', icon: IdCard },
};

const mask = (last4: string | null) => (last4 ? `•••• ${last4}` : '—');
const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export default function KycReviewCard({ kyc }: { kyc: KycCase }) {
  const [approveState, approveAction, approving] = useActionState<KycActionState, FormData>(approveKyc, null);
  const [rejectState, rejectAction, rejecting] = useActionState<KycActionState, FormData>(rejectKyc, null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  async function toggleReveal() {
    if (revealed) { setRevealed(null); return; }
    const reason = window.prompt('Reason for viewing the full account number (logged for audit):', 'KYC payout account verification');
    if (!reason) return;
    setRevealing(true); setRevealError(null);
    const r = await revealPayoutAccount(kyc.supplierId, reason);
    setRevealing(false);
    if (r.ok && r.value) {
      setRevealed(r.value);
      setTimeout(() => setRevealed(null), 60_000);   // auto-hide after a minute
    } else setRevealError(r.message ?? 'Could not reveal');
  }
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const state = rejectState ?? approveState;
  const busy = approving || rejecting;

  const missing = Object.keys(DOC_META).filter((t) => !kyc.documents.some((d) => d.docType === t));
  const reverify = kyc.reviewNotes?.includes('Payout account changed');
  const nameMismatch = kyc.account && kyc.legalName
    && !kyc.account.beneficiary_name.toLowerCase().includes(kyc.legalName.toLowerCase().split(/\s+/)[0] ?? '');
  const checklist = ['Documents are legible and unexpired', 'Legal name & numbers match the documents', 'Payout account holder matches the business'];
  const allChecked = checklist.every((c) => checked[c]);
  const waitedHours = kyc.submittedAt ? Math.floor((Date.now() - new Date(kyc.submittedAt).getTime()) / 3_600_000) : 0;

  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            {flag(kyc.supplier?.country_code ?? 'US')} {kyc.supplier?.company_name ?? kyc.legalName}
          </h2>
          <p className="text-sm text-slate-500">
            {kyc.supplier?.full_name} · joined {kyc.supplier && new Date(kyc.supplier.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {reverify && <span className="rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Payout account changed — re-verify</span>}
          {kyc.heldPayouts.count > 0 && (
            <span className="rounded-md bg-brand-50 px-2 py-0.5 font-medium text-brand-800 ring-1 ring-brand-100">
              {kyc.heldPayouts.count} payout(s) · {formatUSD(kyc.heldPayouts.cents)} waiting
            </span>
          )}
          <span className={clsx('rounded-md px-2 py-0.5 font-medium', waitedHours >= 48 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600')}>
            Waiting {waitedHours}h
          </span>
        </div>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-3">
        {/* Business declaration */}
        <section aria-label="Business details">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Declared details</h3>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Row label="Legal name" value={kyc.legalName} />
            <Row label="Tax ID" value={kyc.taxId} mono />
            <Row label="Registration no." value={kyc.registrationNumber} mono />
            <Row label="Registered address" value={kyc.address} />
            <Row label="Country" value={kyc.supplier ? countryName(kyc.supplier.country_code) : null} />
          </dl>
        </section>

        {/* Documents */}
        <section aria-label="Documents">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</h3>
          <ul className="mt-3 space-y-2">
            {kyc.documents.map((d) => {
              const meta = DOC_META[d.docType] ?? { label: d.docType, icon: FileText };
              const Icon = meta.icon;
              return (
                <li key={d.id}>
                  <a href={d.url ?? undefined} target="_blank" rel="noopener noreferrer"
                    aria-disabled={!d.url}
                    className={clsx('flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 text-sm transition',
                      d.url ? 'hover:border-brand-300 hover:bg-brand-50/40' : 'pointer-events-none opacity-50')}>
                    <Icon className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{meta.label}</span>
                      <span className="block truncate text-xs text-slate-500">{d.fileName} · {kb(d.bytes)}</span>
                    </span>
                    <span className="text-xs font-medium text-brand-700">View</span>
                  </a>
                </li>
              );
            })}
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600"><AlertTriangle className="h-3.5 w-3.5" />Missing: {missing.map((m) => DOC_META[m].label).join(', ')}</p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Links expire 5 minutes after page load — refresh to renew.</p>
        </section>

        {/* Payout account */}
        <section aria-label="Payout account">
          <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payout account
            {kyc.account && (
              <button type="button" onClick={() => void toggleReveal()} disabled={revealing} className="flex items-center gap-1 normal-case text-brand-700"
                aria-pressed={!!revealed}>
                {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {revealed ? 'Hide' : 'Reveal (audited)'}
              </button>
            )}
          </h3>
          {kyc.account ? (
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Type" value={`${kyc.account.method === 'bank' ? 'Bank' : 'Mobile money'} · ${kyc.account.currency} · ${kyc.account.country_code}`} />
              <Row label="Holder" value={kyc.account.beneficiary_name} />
              <Row label={kyc.account.method === 'bank' ? 'Bank' : 'Network'} value={`${kyc.account.bank_name ?? '—'} (${kyc.account.bank_code})`} />
              <Row label="Account" value={revealed ?? mask(kyc.account.account_last4)} mono />
              {revealError && <p className="text-xs text-red-600">{revealError}</p>}
              {kyc.duplicateAccounts > 0 && (
                <p className="flex items-start gap-1.5 rounded-md bg-red-50 p-2 text-xs font-medium text-red-700">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  This bank account is also registered to {kyc.duplicateAccounts} other supplier(s). Investigate before approving.
                </p>
              )}
              {kyc.account.international?.swift_code && <Row label="SWIFT / routing" value={`${kyc.account.international.swift_code} / ${kyc.account.international.routing_number ?? '—'}`} mono />}
              {kyc.account.currency !== 'USD' && (
                <p className="text-xs text-slate-500">{kyc.account.currency} account — payouts convert automatically from USD at Flutterwave&apos;s transfer rate.</p>
              )}
              {nameMismatch && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />Account holder doesn’t obviously match the legal name.</p>
              )}
            </dl>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600"><Landmark className="h-4 w-4" />No payout account on file</p>
          )}
        </section>
      </div>

      <form className="border-t border-slate-100 bg-slate-50/60 px-6 py-5">
        <input type="hidden" name="supplierId" value={kyc.supplierId} />
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer checklist</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {checklist.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!checked[c]} onChange={(e) => setChecked((s) => ({ ...s, [c]: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600" />
                {c}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor={`notes-${kyc.supplierId}`} className="label mt-4 text-xs">Notes to supplier (required to reject)</label>
        <textarea id={`notes-${kyc.supplierId}`} name="notes" rows={2} maxLength={2000} className="input text-sm"
          placeholder="e.g. The registration certificate is expired — please upload the current one." />

        {state && (
          <p role="status" className={clsx('mt-3 flex items-center gap-1.5 text-sm', state.ok ? 'text-emerald-700' : 'text-red-600')}>
            {state.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{state.message}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button formAction={rejectAction} disabled={busy} className="btn-secondary">
            {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Reject with notes
          </button>
          <button formAction={approveAction} disabled={busy || !allChecked || missing.length > 0 || !kyc.account} className="btn-primary"
            title={!allChecked ? 'Complete the checklist first' : undefined}>
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve KYC
          </button>
        </div>
      </form>
    </article>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={clsx('break-words text-slate-900', mono && 'font-mono text-[13px]', !value && 'text-slate-400')}>{value || '—'}</dd>
    </div>
  );
}
