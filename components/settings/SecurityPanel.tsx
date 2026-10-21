'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { passwordStrength, validatePasswordChange, type PasswordChangeErrors } from '@/lib/password';
import { changePassword } from '@/app/dashboard/settings/actions';
import TwoFactorCard, { type TwoFactorStatus } from './TwoFactorCard';

export default function SecurityPanel({ email, twoFactor }: { email: string; twoFactor: TwoFactorStatus }) {
  return (
    <div className="space-y-8">
      <TwoFactorCard status={twoFactor} email={email} />
      <PasswordForm />
    </div>
  );
}

/** Current password is verified on the server; the new one must pass the same rules as sign-up. */
function PasswordForm() {
  const [current, setCurrent] = useState('');
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
    const found = validatePasswordChange(current, next, confirm);
    setErrors(found);
    if (Object.keys(found).length) return;
    start(async () => {
      const res = await changePassword(current, next, confirm);
      if (!res.ok) { setErrors(res.errors ?? {}); if (!res.errors) setFormError(res.message); return; }
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('Password updated', { description: 'Use your new password next time you sign in.' });
    });
  }

  const field = (id: 'current' | 'next' | 'confirm', label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <label htmlFor={`pw-${id}`} className="label">{label}</label>
      <input id={`pw-${id}`} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value}
        onChange={(e) => { set(e.target.value); if (errors[id]) setErrors((x) => ({ ...x, [id]: undefined })); }}
        aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `pw-${id}-error` : undefined}
        className={clsx('input', errors[id] && 'border-red-400 focus:border-red-600 focus:ring-red-600')} />
      {errors[id] && <p id={`pw-${id}-error`} className="mt-1.5 text-xs text-red-600 dark:text-rose-400">{errors[id]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Change password</h3>
        <p className="mt-1 text-sm text-neutral-600">At least 10 characters, with upper &amp; lower case letters or a number and a symbol.</p>
      </div>
      {field('current', 'Current password', current, setCurrent, 'current-password')}
      {field('next', 'New password', next, setNext, 'new-password')}
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
      {field('confirm', 'Confirm new password', confirm, setConfirm, 'new-password')}
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} Show passwords
      </label>
      {formError && <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{formError}</p>}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Update password
      </button>
    </form>
  );
}
