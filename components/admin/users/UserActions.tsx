'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { deleteUser, setUserBan } from '@/app/admin/users/actions';

type Mode = 'ban' | 'unban' | 'delete';

/** Ban / unban / delete with a confirmation dialog. All checks run again on the server and in SQL. */
export default function UserActions({ userId, name, isBanned, isAdmin, isSelf }: {
  userId: string; name: string; isBanned: boolean; isAdmin: boolean; isSelf: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>('ban');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (isAdmin || isSelf) return <span className="text-xs text-neutral-400">{isSelf ? 'You' : 'Protected'}</span>;

  const open = (m: Mode) => { setMode(m); setText(''); setError(null); dialogRef.current?.showModal(); };
  const close = () => dialogRef.current?.close();

  const confirm = () => start(async () => {
    const res = mode === 'delete' ? await deleteUser(userId, text) : await setUserBan(userId, mode === 'ban', text);
    if (!res.ok && !res.applied) { setError(res.message); return; }
    (res.ok ? toast.success : toast.warning)(res.message, { description: name });
    close();
    router.refresh();
  });

  const copy = {
    ban: { title: `Ban ${name}?`, body: 'They are signed out, cannot sign in, and cannot place orders, pledge, list products or send messages. Existing escrow orders continue.', label: 'Reason (shown in the audit log)', button: 'Ban user', danger: true },
    unban: { title: `Unban ${name}?`, body: 'They can sign in and use SokoGlobal again.', label: 'Note (optional)', button: 'Unban user', danger: false },
    delete: { title: `Delete ${name}?`, body: 'This permanently removes the login and profile. Accounts with orders, products, pledges or payouts cannot be deleted — ban them instead.', label: 'Type DELETE to confirm', button: 'Delete permanently', danger: true },
  }[mode];

  return (
    <div className="flex items-center justify-end gap-1">
      {isBanned ? (
        <button type="button" onClick={() => open('unban')} className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Unban
        </button>
      ) : (
        <button type="button" onClick={() => open('ban')} className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-400">
          <Ban className="h-3.5 w-3.5" aria-hidden /> Ban
        </button>
      )}
      <button type="button" onClick={() => open('delete')} aria-label={`Delete ${name}`} className="press inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-400">
        <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
      </button>

      <dialog ref={dialogRef} aria-labelledby={`dlg-${userId}`}
        className="w-[calc(100%-2rem)] max-w-md rounded-[18px] border border-black/[0.06] p-0 text-left text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`dlg-${userId}`} className="text-base font-semibold">{copy.title}</h2>
            <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-neutral-500 hover:text-neutral-900"><X className="h-4 w-4" aria-hidden /></button>
          </div>
          <p className="mt-2 text-sm text-neutral-600">{copy.body}</p>
          <label htmlFor={`dlg-in-${userId}`} className="label mt-4">{copy.label}</label>
          {mode === 'delete'
            ? <input id={`dlg-in-${userId}`} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" className="input" placeholder="DELETE" />
            : <textarea id={`dlg-in-${userId}`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} className="input" />}
          {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary px-3 py-2">Cancel</button>
            <button type="button" onClick={confirm} disabled={pending || (mode === 'delete' && text.trim().toUpperCase() !== 'DELETE')}
              className={copy.danger ? 'btn-primary bg-rose-600 px-3 py-2 hover:bg-rose-500' : 'btn-primary px-3 py-2'}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {copy.button}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
