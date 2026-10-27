'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FileCheck2, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { acceptCurrentTerms } from '@/app/dashboard/settings/account-actions';
import { LEGAL_DOCS, legalEffectiveDate } from '@/lib/legal';

/**
 * Blocking dialog: accept the current documents to continue, or sign out. The page behind is inert. Settings stays
 * reachable without accepting, so someone who disagrees can still download their data or close their account.
 */
const SETTINGS = '/dashboard/settings';
export default function TermsPrompt({ updated }: { updated: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const onSettings = path === SETTINGS || path.startsWith(`${SETTINGS}/`);
  const { signOut } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onSettings) return;
    const main = document.querySelector('main');
    main?.setAttribute('inert', '');
    dialog.current?.focus();
    return () => main?.removeAttribute('inert');
  }, [onSettings]);

  const accept = () => start(async () => {
    setError(null);
    const res = await acceptCurrentTerms();
    if (!res.ok) { setError(res.message); return; }
    router.refresh();
  });

  if (onSettings) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="terms-title" className="card w-full max-w-md p-6 focus:outline-none sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-xl border tone-active"><FileCheck2 className="h-5 w-5" aria-hidden /></span>
        <h2 id="terms-title" className="mt-4 text-xl font-semibold text-neutral-900">{updated ? 'Our terms have been updated' : 'Please review our terms'}</h2>
        <p className="mt-2 text-sm text-neutral-600">
          To keep using SokoGlobal, please read and accept the documents that govern your orders, escrow payments and data
          (effective {legalEffectiveDate()}).
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {LEGAL_DOCS.map((d) => (
            <li key={d.slug}><a href={d.href} target="_blank" rel="noopener" className="font-medium text-neutral-900 underline underline-offset-4">{d.title}</a></li>
          ))}
        </ul>
        <label className="mt-5 flex items-start gap-2.5 text-sm text-neutral-700">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-[#5a9895]" />
          <span>I agree to the Terms of Trade and the Escrow Agreement, and I have read the Privacy Policy.</span>
        </label>
        <p className="mt-3 text-xs text-neutral-500">
          Don’t agree? You can <a href={`${SETTINGS}?tab=security#account-data`} className="underline underline-offset-4">download your data or close your account</a>.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-neutral-900">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
          <button type="button" onClick={accept} disabled={!agreed || pending} className="btn-primary">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Accept and continue
          </button>
        </div>
      </div>
    </div>
  );
}
