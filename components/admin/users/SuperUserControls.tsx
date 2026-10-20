'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Eye, Loader2, Snowflake, Sun, X } from 'lucide-react';
import { grantTempAdmin, revokeTempAdmin, setAccountFrozen } from '@/app/admin/users/actions';
import { GRANT_PRESETS, formatTimeLeft } from '@/lib/auth/admin-access';

type Mode = 'grant' | 'revoke' | 'freeze' | 'unfreeze';

/**
 * Super admin row controls: temporary admin access (a switch), freeze / unfreeze,
 * and the read-only View-As inspector. Every action is re-checked in Postgres
 * (super_* functions) and written to the immutable audit log with the caller's IP.
 */
export default function SuperUserControls({ userId, name, targetIsAdmin, targetIsSuper, isFrozen, grantId, grantExpiresAt }: {
  userId: string; name: string; targetIsAdmin: boolean; targetIsSuper: boolean; isFrozen: boolean;
  grantId: string | null; grantExpiresAt: string | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>('grant');
  const [hours, setHours] = useState('24');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasGrant = !!grantId && !!grantExpiresAt && Date.parse(grantExpiresAt) > Date.now();

  const open = (m: Mode) => { setMode(m); setReason(''); setError(null); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();

  const confirm = () => start(async () => {
    const res = mode === 'grant' ? await grantTempAdmin(userId, Number(hours), reason)
      : mode === 'revoke' ? await revokeTempAdmin(grantId ?? '')
      : await setAccountFrozen(userId, mode === 'freeze', reason);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message, { description: name });
    close();
    router.refresh();
  });

  const copy = {
    grant: { title: `Give ${name} temporary admin access`, body: 'They keep their own account and gain every admin page (review, orders, users, support) until the expiry. They cannot use the Control room or super admin overrides.', button: 'Grant access' },
    revoke: { title: `Revoke ${name}'s admin access?`, body: 'Access ends on their next request. The grant stays in the audit log.', button: 'Revoke now' },
    freeze: { title: `Freeze ${name}?`, body: 'For disputes and investigations: they can still sign in and message, but cannot place orders, pay, pledge or receive payouts. Escrow already held stays held.', button: 'Freeze account' },
    unfreeze: { title: `Unfreeze ${name}?`, body: 'Ordering, payments and payouts work again.', button: 'Unfreeze' },
  }[mode];

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {!targetIsAdmin && (
        <button type="button" role="switch" aria-checked={hasGrant} onClick={() => open(hasGrant ? 'revoke' : 'grant')}
          title={hasGrant ? `Temporary admin, ${formatTimeLeft(grantExpiresAt!)}. Click to revoke.` : 'Grant temporary admin access'}
          className="press inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100">
          <span aria-hidden className={clsx('relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors', hasGrant ? 'bg-violet-600' : 'bg-neutral-300')}>
            <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-snow shadow transition-transform', hasGrant ? 'translate-x-3.5' : 'translate-x-0.5')} />
          </span>
          Admin
        </button>
      )}
      {!targetIsSuper && (isFrozen ? (
        <button type="button" onClick={() => open('unfreeze')} className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
          <Sun className="h-3.5 w-3.5" aria-hidden /> Unfreeze
        </button>
      ) : (
        <button type="button" onClick={() => open('freeze')} className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-500/10 dark:text-sky-300">
          <Snowflake className="h-3.5 w-3.5" aria-hidden /> Freeze
        </button>
      ))}
      <Link href={`/admin/view-as/${userId}`} aria-label={`View ${name}'s portal (read-only)`}
        className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-500/10 dark:text-cyan-300">
        <Eye className="h-3.5 w-3.5" aria-hidden /> View as
      </Link>

      <dialog ref={dialogRef} aria-labelledby={`sdlg-${userId}`}
        className="w-[calc(100%-2rem)] max-w-md rounded-[18px] border border-black/[0.06] p-0 text-left text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`sdlg-${userId}`} className="text-base font-semibold">{copy.title}</h2>
            <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-neutral-500 hover:text-neutral-900"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <p className="mt-2 text-sm text-neutral-600">{copy.body}</p>
          {mode === 'grant' && (
            <>
              <label htmlFor={`sdlg-h-${userId}`} className="label mt-4">Access lasts</label>
              <select id={`sdlg-h-${userId}`} value={hours} onChange={(e) => setHours(e.target.value)} className="input">
                {GRANT_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </>
          )}
          {mode !== 'revoke' && mode !== 'unfreeze' && (
            <>
              <label htmlFor={`sdlg-r-${userId}`} className="label mt-4">Reason (kept in the audit log)</label>
              <textarea id={`sdlg-r-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="input" />
            </>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary px-3 py-2">Cancel</button>
            <button type="button" onClick={confirm} disabled={pending || ((mode === 'grant' || mode === 'freeze') && reason.trim().length < 5)}
              className={mode === 'freeze' || mode === 'revoke' ? 'btn-primary bg-rose-600 px-3 py-2 hover:bg-rose-500' : 'btn-primary px-3 py-2'}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {copy.button}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
