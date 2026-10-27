'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, Download, Loader2, UserX } from 'lucide-react';
import { accountClosureStatus, closeAccount } from '@/app/dashboard/settings/account-actions';
import { CLOSE_CONFIRMATION, isCloseConfirmation } from '@/lib/account';

/** Privacy Policy §9: download everything the account holds, or close the account (migration 040). */
export default function AccountDataCard() {
  const [step, setStep] = useState<'idle' | 'checking' | 'blocked' | 'confirm'>('idle');
  const [blockers, setBlockers] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const check = () => start(async () => {
    setError(null);
    setStep('checking');
    const res = await accountClosureStatus();
    if (res.blockers?.length) { setBlockers(res.blockers); setStep('blocked'); return; }
    if (!res.ok) { setError(res.message); setStep('idle'); return; }
    setStep('confirm');
  });

  const close = () => start(async () => {
    setError(null);
    const res = await closeAccount(typed);
    if (res.blockers?.length) { setBlockers(res.blockers); setStep('blocked'); return; }
    if (!res.ok) { setError(res.message); return; }
    window.location.assign('/');
  });

  return (
    <section id="account-data" aria-labelledby="account-data-h" className="max-w-md scroll-mt-24 space-y-6">
      <div>
        <h3 id="account-data-h" className="text-sm font-semibold text-neutral-900">Your data</h3>
        <p className="mt-1 text-sm text-neutral-600">A JSON file with your profile, orders, payments, messages, listings and verification records.</p>
        {/* A file download from a route handler, not a page. */}
        <a href="/api/account/export" download className="btn-secondary mt-3"><Download className="h-4 w-4" aria-hidden /> Download my data</a>
      </div>

      <div className="rounded-xl border border-red-200 p-4 dark:border-rose-400/30">
        <h3 className="text-sm font-semibold text-neutral-900">Close account</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Your profile is anonymised, listings are taken down and you can no longer sign in. Order, payment, payout and verification
          records are kept for the periods in our <a href="/legal/privacy#retention" className="underline underline-offset-4">Privacy Policy</a>.
        </p>

        {step === 'blocked' && (
          <div role="alert" className="mt-3 rounded-lg border px-3 py-2.5 text-sm tone-pending">
            <p className="font-medium">Finish these first:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}

        {step === 'confirm' ? (
          <div className="mt-3 space-y-3">
            <label htmlFor="close-confirm" className="label">Type {CLOSE_CONFIRMATION} to confirm. This cannot be undone.</label>
            <input id="close-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="input font-mono" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={close} disabled={pending || !isCloseConfirmation(typed)}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserX className="h-4 w-4" aria-hidden />} Close my account
              </button>
              <button type="button" onClick={() => { setStep('idle'); setTyped(''); }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={check} disabled={pending} className="btn-secondary mt-3">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserX className="h-4 w-4" aria-hidden />} {step === 'blocked' ? 'Check again' : 'Close my account…'}
          </button>
        )}
        {error && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      </div>
    </section>
  );
}
