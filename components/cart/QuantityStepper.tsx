'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import clsx from 'clsx';
import { Minus, Plus } from 'lucide-react';
import { MAX_BATCHES_PER_LINE, clampQuantity } from '@/lib/cart';

/**
 * − [n] + control for Trial Batch quantities. The input accepts typing;
 * the value is clamped to 1..20 on blur/Enter. Clicks don't bubble, so it can
 * sit inside clickable product cards.
 */
export default function QuantityStepper({ value, onChange, label = 'Quantity', size = 'md', disabled, className }: {
  value: number;
  onChange: (quantity: number) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = (raw: string | number) => {
    const q = clampQuantity(raw);
    setDraft(String(q));
    if (q !== value) onChange(q);
  };
  const step = (delta: number) => (e: MouseEvent) => { e.stopPropagation(); commit(value + delta); };
  const btn = clsx('grid place-items-center text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40',
    size === 'sm' ? 'h-8 w-8' : 'h-10 w-10');

  return (
    <div role="group" aria-label={label} onClick={(e) => e.stopPropagation()}
      className={clsx('inline-flex items-center overflow-hidden rounded-md border border-neutral-300 bg-white', className)}>
      <button type="button" onClick={step(-1)} disabled={disabled || value <= 1} aria-label={`Decrease ${label.toLowerCase()}`} className={btn}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input type="number" inputMode="numeric" min={1} max={MAX_BATCHES_PER_LINE} step={1} value={draft} disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(draft); } }}
        className={clsx('w-12 border-x border-neutral-300 bg-white text-center text-sm font-medium tabular-nums text-neutral-900 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-neutral-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          size === 'sm' ? 'h-8' : 'h-10')} />
      <button type="button" onClick={step(1)} disabled={disabled || value >= MAX_BATCHES_PER_LINE} aria-label={`Increase ${label.toLowerCase()}`} className={btn}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
