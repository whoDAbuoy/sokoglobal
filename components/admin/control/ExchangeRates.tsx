'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { setExchangeRate } from '@/app/admin/control/actions';
import { CURRENCY_LABEL, type CurrencyCode } from '@/lib/currency';

export interface RateRow { currency_code: CurrencyCode; rate_to_kes: number; updated_at: string }

/**
 * Display rates for the header currency switcher and RFQ pricing (KES per 1 unit).
 * They never change a charge in flight: card and M-Pesa amounts come from the
 * payment configuration, and an RFQ order's rate is frozen when it is accepted.
 */
export default function ExchangeRates({ rows, canEdit }: { rows: RateRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(() => Object.fromEntries(rows.map((r) => [r.currency_code, String(r.rate_to_kes)])));
  const [pending, start] = useTransition();
  const editable = rows.filter((r) => r.currency_code !== 'KES');
  const dirty = editable.filter((r) => Number(values[r.currency_code]) !== Number(r.rate_to_kes));

  const save = () => start(async () => {
    for (const r of dirty) {
      const res = await setExchangeRate(r.currency_code, values[r.currency_code]);
      if (!res.ok) { toast.error(`${r.currency_code}: ${res.message}`); return; }
    }
    toast.success('Exchange rates saved');
    router.refresh();
  });

  return (
    <div>
      <ul className="space-y-3">
        {editable.map((r) => {
          const n = Number(values[r.currency_code]);
          return (
            <li key={r.currency_code} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 text-sm">
              <label htmlFor={`fx-${r.currency_code}`} className="font-medium text-neutral-900" title={CURRENCY_LABEL[r.currency_code]}>{r.currency_code}</label>
              <div>
                <div className="flex items-center gap-2">
                  <input id={`fx-${r.currency_code}`} inputMode="decimal" value={values[r.currency_code]} disabled={!canEdit || pending}
                    onChange={(e) => setValues((v) => ({ ...v, [r.currency_code]: e.target.value }))} className="input max-w-[10rem] tabular-nums" />
                  <span className="text-xs text-neutral-500">KES per 1 {r.currency_code}</span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {n > 0 ? `1 KES = ${(1 / n).toLocaleString('en-US', { maximumSignificantDigits: 5 })} ${r.currency_code}` : 'Enter a positive rate'} ·
                  {' '}updated {new Date(r.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <button type="button" onClick={save} disabled={pending || !dirty.length} className="btn-primary mt-4">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save rates
        </button>
      )}
    </div>
  );
}
