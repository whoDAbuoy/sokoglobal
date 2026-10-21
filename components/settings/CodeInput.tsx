'use client';

import clsx from 'clsx';

/** 6-digit one-time code field (numeric keypad, OS autofill from SMS/password managers). */
export default function CodeInput({ id, value, onChange, disabled, invalid, label = 'Authenticator code', autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean; label?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="••••••" disabled={disabled}
        autoFocus={autoFocus} aria-invalid={invalid || undefined}
        className={clsx('input max-w-[11rem] text-center font-mono text-lg tracking-[0.4em] tabular-nums', invalid && 'border-red-400 focus:border-red-600 focus:ring-red-600')} />
    </div>
  );
}
