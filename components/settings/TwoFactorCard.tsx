'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Copy, Download, KeyRound, Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import CodeInput from './CodeInput';

export interface TwoFactorStatus {
  enabled: boolean; verifiedAt: string | null; backupLeft: number | null; configured: boolean; available: boolean; isSuperAdmin: boolean;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'scan'; qr: string; secret: string }
  | { kind: 'codes'; codes: string[]; title: string }
  | { kind: 'manage'; action: 'disable' | 'regenerate' };

async function post<T>(path: string, body?: object): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(`/api/auth/2fa/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (res.status === 429) return { ok: false, error: 'Too many attempts. Wait a minute and try again.' };
  return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? 'Something went wrong. Please try again.' };
}

/**
 * TOTP setup and management. Every step is decided on the server (/api/auth/2fa/*):
 * the secret is generated and stored encrypted there, and 2FA only switches on after
 * the server has verified a code from the user's app.
 */
export default function TwoFactorCard({ status, email }: { status: TwoFactorStatus; email: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (next: Step = { kind: 'idle' }) => { setStep(next); setCode(''); setBackup(''); setUseBackup(false); setError(null); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } finally { setBusy(false); } };

  const begin = () => run(async () => {
    const r = await post<{ qr: string; secret: string }>('enroll');
    if (!r.ok) return setError(r.error);
    reset({ kind: 'scan', qr: r.data.qr, secret: r.data.secret });
  });
  const confirm = () => run(async () => {
    const r = await post<{ backupCodes: string[] }>('verify', { code });
    if (!r.ok) return setError(r.error);
    reset({ kind: 'codes', codes: r.data.backupCodes, title: 'Two-factor authentication is on' });
  });
  const manage = (action: 'disable' | 'regenerate') => run(async () => {
    const body = useBackup && action === 'disable' ? { backupCode: backup } : { code };
    if (action === 'disable') {
      const r = await post<{ ok: true }>('disable', body);
      if (!r.ok) return setError(r.error);
      toast.success('Two-factor authentication is off');
      reset();
      router.refresh();
    } else {
      const r = await post<{ backupCodes: string[] }>('backup-codes', body);
      if (!r.ok) return setError(r.error);
      reset({ kind: 'codes', codes: r.data.backupCodes, title: 'New backup codes' });
    }
  });

  if (!status.available) {
    return <Shell enabled={false}><p className="text-sm text-neutral-600">Two-factor authentication becomes available once the security update (migration 016) is applied.</p></Shell>;
  }

  return (
    <Shell enabled={status.enabled || step.kind === 'codes'}>
      {step.kind === 'codes' ? (
        <BackupCodes codes={step.codes} title={step.title} email={email} onDone={() => { reset(); router.refresh(); }} />
      ) : step.kind === 'scan' ? (
        <div className="space-y-5">
          <ol className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            <li className="space-y-2">
              <p className="text-sm font-medium text-neutral-900">1. Scan with your authenticator app</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data: URL */}
              <img src={step.qr} alt="QR code for your authenticator app" width={192} height={192} className="h-48 w-48 rounded-xl bg-white p-2 ring-1 ring-neutral-200" />
            </li>
            <li className="min-w-0 space-y-2">
              <p className="text-sm font-medium text-neutral-900">Or enter this key</p>
              <code className="block break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-sm tracking-wider text-neutral-900">{step.secret}</code>
              <p className="text-xs text-neutral-600">Works with Google Authenticator, Authy, 1Password and Microsoft Authenticator. Time-based, 6 digits.</p>
              <div className="pt-2">
                <p className="text-sm font-medium text-neutral-900">2. Enter the code it shows</p>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <CodeInput id="enroll-code" value={code} onChange={setCode} disabled={busy} invalid={!!error} autoFocus />
                  <button type="button" onClick={confirm} disabled={busy || code.length !== 6} className="btn-primary px-4 py-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Verify &amp; turn on
                  </button>
                </div>
              </div>
            </li>
          </ol>
          <ErrorLine error={error} />
          <button type="button" onClick={() => reset()} className="text-sm text-neutral-600 hover:text-neutral-900">Cancel setup</button>
        </div>
      ) : step.kind === 'manage' ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            {step.action === 'disable' ? 'Confirm with a code from your authenticator app (or a backup code) to turn two-factor authentication off.' : 'Confirm with a code from your authenticator app. Your old backup codes stop working.'}
          </p>
          {useBackup ? (
            <div>
              <label htmlFor="mg-backup" className="label">Backup code</label>
              <input id="mg-backup" value={backup} onChange={(e) => setBackup(e.target.value.toUpperCase().slice(0, 9))} placeholder="ABCD-EFGH" className="input max-w-[13rem] font-mono tracking-widest" />
            </div>
          ) : <CodeInput id="mg-code" value={code} onChange={setCode} disabled={busy} invalid={!!error} autoFocus />}
          {step.action === 'disable' && (
            <button type="button" onClick={() => { setUseBackup(!useBackup); setError(null); }} className="text-sm font-medium text-blue-700 hover:underline dark:text-cyan-300">
              {useBackup ? 'Use the authenticator app' : 'Use a backup code instead'}
            </button>
          )}
          <ErrorLine error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => manage(step.action)} disabled={busy || (useBackup ? backup.replace(/[^A-Z0-9]/g, '').length !== 8 : code.length !== 6)}
              className={clsx('btn-primary px-4 py-2', step.action === 'disable' && 'bg-rose-600 hover:bg-rose-500')}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {step.action === 'disable' ? 'Turn off 2FA' : 'Generate new codes'}
            </button>
            <button type="button" onClick={() => reset()} className="btn-secondary px-4 py-2">Cancel</button>
          </div>
        </div>
      ) : status.enabled ? (
        <div className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="eyebrow">Turned on</dt><dd className="mt-1 text-sm text-neutral-900">{status.verifiedAt ? new Date(status.verifiedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—'}</dd></div>
            <div><dt className="eyebrow">Backup codes left</dt>
              <dd className={clsx('mt-1 text-sm', (status.backupLeft ?? 10) <= 3 ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-neutral-900')}>
                {status.backupLeft ?? '—'}{(status.backupLeft ?? 10) <= 3 && ' · generate new ones'}
              </dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => reset({ kind: 'manage', action: 'regenerate' })} className="btn-secondary px-3 py-2 text-sm"><KeyRound className="h-4 w-4" aria-hidden /> New backup codes</button>
            <button type="button" onClick={() => reset({ kind: 'manage', action: 'disable' })} className="press inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-400">
              <ShieldOff className="h-4 w-4" aria-hidden /> Turn off
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            Add a 6-digit code from your phone to every sign-in, so a stolen password alone can’t open your account.
            {status.isSuperAdmin && <strong className="mt-1 block font-medium text-neutral-900">Required for force-release, refunds, payouts and landed-cost overrides.</strong>}
          </p>
          {status.configured ? (
            <button type="button" onClick={begin} disabled={busy} className="btn-primary px-4 py-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Smartphone className="h-4 w-4" aria-hidden />} Enable 2FA
            </button>
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-300">Two-factor authentication isn’t available yet: the server key is not configured.</p>
          )}
          <ErrorLine error={error} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby="tfa-title" className="rounded-[18px] border border-neutral-200 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="tfa-title" className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><ShieldCheck className="h-4 w-4 text-neutral-500" aria-hidden /> Two-factor authentication</h3>
        <span className={clsx('pill', enabled ? 'tone-escrow' : 'tone-muted')}>{enabled ? 'On' : 'Off'}</span>
      </div>
      {children}
    </section>
  );
}

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null;

/** Shown once: the server keeps only keyed hashes, so these cannot be displayed again. */
function BackupCodes({ codes, title, email, onDone }: { codes: string[]; title: string; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `SokoGlobal backup codes for ${email}\nEach code works once. Generated ${new Date().toLocaleString('en-GB')}.\n\n${codes.join('\n')}\n`;
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast.success('Codes copied'); } catch { toast.error('Copy failed. Select the codes and copy them.'); } };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'sokoglobal-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden /> {title}</p>
      <p className="text-sm text-neutral-700">Save these backup codes somewhere safe. Each works once if you lose your phone. <strong className="font-medium text-neutral-900">They won’t be shown again.</strong></p>
      <ul aria-label="Backup codes" className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-4 font-mono text-sm tracking-wider text-neutral-900 sm:grid-cols-5">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="btn-secondary px-3 py-2 text-sm"><Copy className="h-4 w-4" aria-hidden /> Copy</button>
        <button type="button" onClick={download} className="btn-secondary px-3 py-2 text-sm"><Download className="h-4 w-4" aria-hidden /> Download .txt</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" /> I’ve saved my backup codes
      </label>
      <button type="button" onClick={onDone} disabled={!saved} className="btn-primary px-4 py-2">Done</button>
    </div>
  );
}
