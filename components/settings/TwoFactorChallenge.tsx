'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, KeyRound, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import CodeInput from './CodeInput';

/** The /auth/2fa form: authenticator code, or a single-use backup code. */
export default function TwoFactorChallenge({ next }: { next: string }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/2fa/challenge', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(useBackup ? { backupCode: backup } : { code }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : body.error ?? 'Could not verify the code.'); return; }
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {useBackup ? (
        <div>
          <label htmlFor="backup-code" className="label">Backup code</label>
          <input id="backup-code" value={backup} onChange={(e) => setBackup(e.target.value.toUpperCase().slice(0, 9))} autoComplete="off" autoFocus
            placeholder="ABCD-EFGH" className="input max-w-[13rem] font-mono tracking-widest" />
        </div>
      ) : (
        <CodeInput id="totp-code" value={code} onChange={setCode} disabled={busy} invalid={!!error} autoFocus />
      )}
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      <button type="submit" disabled={busy || (useBackup ? backup.replace(/[^A-Z0-9]/g, '').length !== 8 : code.length !== 6)} className="btn-primary w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Verify
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button type="button" onClick={() => { setUseBackup(!useBackup); setError(null); }} className="font-medium text-blue-700 hover:underline dark:text-cyan-300">
          {useBackup ? 'Use the authenticator app' : 'Lost your device? Use a backup code'}
        </button>
        <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-900">
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </form>
  );
}
