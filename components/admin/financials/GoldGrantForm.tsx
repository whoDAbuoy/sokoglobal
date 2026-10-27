'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Crown, Loader2, X } from 'lucide-react';
import { grantGold, revokeGold, type GoldGrantResult } from '@/app/admin/financials/actions';
import { GRANT_MONTH_OPTIONS, type FieldErrors } from '@/lib/gold-grant';

/**
 * Give a supplier Gold without a charge, or end it. The email picks the account; the reason is
 * written to the audit log. Grants extend a running period; revoking ends it now.
 */
export default function GoldGrantForm({ moneyBlocked }: { moneyBlocked: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [months, setMonths] = useState('12');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<GoldGrantResult>) => start(async () => {
    const res = await fn();
    setErrors(res.errors ?? {});
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) { setReason(''); router.refresh(); }
  });
  const field = (name: keyof FieldErrors) => errors[name]
    ? { 'aria-invalid': true, 'aria-describedby': `gold-${name}-error` }
    : {};
  const errorText = (name: keyof FieldErrors) => errors[name] && <p id={`gold-${name}-error`} className="mt-1 text-xs text-red-600">{errors[name]}</p>;
  const disabled = pending || !!moneyBlocked;

  return (
    <form className="glass-card p-5" onSubmit={(e) => { e.preventDefault(); run(() => grantGold({ email, months, reason })); }}>
      {moneyBlocked && <p role="note" className="mb-4 rounded-2xl border px-4 py-3 text-sm tone-pending">{moneyBlocked} Granting or ending Gold needs it.</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]">
        <div>
          <label htmlFor="gold-email" className="label text-[11px]">Supplier account email</label>
          <input id="gold-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="supplier@example.com" className="input py-1.5 text-sm" disabled={disabled} required {...field('email')} />
          {errorText('email')}
        </div>
        <div>
          <label htmlFor="gold-months" className="label text-[11px]">Length</label>
          <select id="gold-months" value={months} onChange={(e) => setMonths(e.target.value)} className="input py-1.5 text-sm" disabled={disabled} {...field('months')}>
            {GRANT_MONTH_OPTIONS.map((m) => <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>)}
          </select>
          {errorText('months')}
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="gold-reason" className="label text-[11px]">Reason (kept in the audit log)</label>
        <input id="gold-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
          placeholder="e.g. Launch partner, 12 months free" className="input py-1.5 text-sm" disabled={disabled} required {...field('reason')} />
        {errorText('reason')}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={disabled} className="btn-primary rounded-full px-4 py-2 text-sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Crown className="h-4 w-4" aria-hidden />} Grant Gold
        </button>
        <button type="button" disabled={disabled} onClick={() => run(() => revokeGold({ email, reason }))} className="btn-secondary rounded-full px-4 py-2 text-sm">
          <X className="h-4 w-4" aria-hidden /> End Gold now
        </button>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Suppliers only. A grant adds to any time they still have; no charge is made, so it doesn’t count as revenue.
        Gold lowers commission on orders placed while it’s active and shows the Gold badge.
      </p>
    </form>
  );
}
