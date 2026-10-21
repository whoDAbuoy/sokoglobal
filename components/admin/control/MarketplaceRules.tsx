'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Loader2, Save } from 'lucide-react';
import { saveKycRequirements, saveTrialBatchConfig } from '@/app/admin/control/actions';
import type { TrialBatchConfig } from '@/lib/trial-batch';
import type { KycRequirements } from '@/lib/kyc';

function Switch({ id, on, onChange, disabled, tone = 'blue' }: { id: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; tone?: 'blue' | 'rose' }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!on)}
      className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50',
        on ? (tone === 'rose' ? 'bg-rose-600' : 'bg-blue-600') : 'bg-neutral-300')}>
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-snow shadow transition-transform motion-reduce:transition-none', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

/** Trial batch switch + minimum, and which actions need KYC. Super admins edit; everyone else reads. */
export default function MarketplaceRules({ trial, kyc, canEdit, updatedAt }: { trial: TrialBatchConfig; kyc: KycRequirements; canEdit: boolean; updatedAt?: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(trial.enabled);
  const [minimum, setMinimum] = useState(trial.minimum_amount.toFixed(2));
  const [listings, setListings] = useState(kyc.listings);
  const [orders, setOrders] = useState(kyc.orders);
  const [pending, start] = useTransition();
  const trialDirty = enabled !== trial.enabled || Number(minimum.replace(/[,$\s]/g, '')) !== trial.minimum_amount;
  const kycDirty = listings !== kyc.listings || orders !== kyc.orders;

  const save = () => start(async () => {
    if (trialDirty) {
      if (!enabled && trial.enabled && !window.confirm('Pause trial batches? Buyers cannot start new trial orders until you turn them back on.')) return;
      const r = await saveTrialBatchConfig(enabled, minimum);
      (r.ok ? toast.success : toast.error)(r.ok ? 'Trial batch settings saved' : r.message);
      if (!r.ok) return;
    }
    if (kycDirty) {
      const r = await saveKycRequirements(listings, orders);
      (r.ok ? toast.success : toast.error)(r.ok ? 'KYC requirements saved' : r.message);
      if (!r.ok) return;
    }
    router.refresh();
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Trial batches</h3>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <p id="mr-trial" className="text-sm font-medium text-neutral-900">Accept new trial batch orders</p>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">Off pauses new trial orders and carts platform-wide. Orders already paid continue.</p>
          </div>
          <Switch id="mr-trial" on={enabled} onChange={setEnabled} disabled={!canEdit || pending} />
        </div>
        <label htmlFor="mr-min" className="label mt-4">Minimum Guaranteed Landed Cost (USD)</label>
        <div className="relative max-w-[12rem]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">$</span>
          <input id="mr-min" inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} disabled={!canEdit || pending} className="input pl-7 tabular-nums" />
        </div>
        <p className="mt-1 text-xs text-neutral-600">Applies to new trial orders and to listings going live. Existing live listings are not affected.</p>
      </div>

      <div className="border-t border-neutral-200 pt-5">
        <h3 className="text-sm font-semibold text-neutral-900">KYC requirements</h3>
        {([['mr-kyc-l', 'Verified suppliers only can create listings', listings, setListings], ['mr-kyc-o', 'Verified buyers only can place escrow orders', orders, setOrders]] as const).map(([id, label, on, set]) => (
          <div key={id} className="mt-3 flex items-start justify-between gap-4">
            <p id={id} className="text-sm font-medium text-neutral-900">{label}</p>
            <Switch id={id} on={on} onChange={set} disabled={!canEdit || pending} />
          </div>
        ))}
        <p className="mt-2 text-xs text-neutral-600">Supplier payouts always need approved supplier KYC.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-600">
          {canEdit ? 'Changes are written to the audit log.' : 'Read-only: only super admins change marketplace rules.'}
          {updatedAt && ` Last change ${new Date(updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`}
        </p>
        {canEdit && (
          <button type="button" onClick={save} disabled={pending || (!trialDirty && !kycDirty)} className="btn-primary px-4 py-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save rules
          </button>
        )}
      </div>
    </div>
  );
}
