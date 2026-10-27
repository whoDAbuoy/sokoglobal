'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { passwordStrength, validatePasswordReset, type PasswordChangeErrors } from '@/lib/password';
import { resetPassword } from '@/app/auth/reset-password/actions';

/** New password + confirmation for a reset-link session; the server re-checks the rules and the session. */
export default function ResetPasswordForm({ home }: { home: string }) {
  const router = useRouter();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<PasswordChangeErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const strength = passwordStrength(next);

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validatePasswordReset(next, confirm);
    setErrors(found);
    if (Object.keys(found).length) return;
    start(async () => {
      const res = await resetPassword(next, confirm);
      if (!res.ok) { setErrors(res.errors ?? {}); if (!res.errors) setFormError(res.message); return; }
      toast.success('Password updated', { description: 'You’re signed in. Use your new password next time.' });
      router.replace(home);
      router.refresh();
    });
  }

  const field = (id: 'next' | 'confirm', label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={`reset-${id}`} className="label">{label}</label>
      <input id={`reset-${id}`} type={show ? 'text' : 'password'} autoComplete="new-password" value={value}
        onChange={(e) => { set(e.target.value); if (errors[id]) setErrors((x) => ({ ...x, [id]: undefined })); }}
        aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `reset-${id}-error` : undefined}
        className={clsx('input', errors[id] && 'border-red-400 focus:border-red-600 focus:ring-red-600')} />
      {errors[id] && <p id={`reset-${id}-error`} className="mt-1.5 text-xs text-red-600 dark:text-rose-400">{errors[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-5">
      {field('next', 'New password', next, setNext)}
      {next && (
        <div className="-mt-3 flex items-center gap-2" aria-live="polite">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3].map((i) => (
              <span key={i} className={clsx('h-1 flex-1 rounded-full transition-colors',
                strength.score >= i ? ['bg-red-500', 'bg-amber-500', 'bg-emerald-500'][strength.score - 1] : 'bg-neutral-200')} />
            ))}
          </div>
          <span className="text-xs text-neutral-600">{strength.label}</span>
        </div>
      )}
      {field('confirm', 'Confirm new password', confirm, setConfirm)}
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} Show passwords
      </label>
      {formError && <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{formError}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Save new password
      </button>
    </form>
  );
}
