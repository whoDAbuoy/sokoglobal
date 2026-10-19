'use client';

import { useEffect, useId, useState } from 'react';

/** Animated ring (0–100) with a blue→cyan→emerald gradient stroke. Respects reduced motion via the global CSS guard. */
export default function PayoutDial({ pct, value, caption, label }: { pct: number; value: string; caption: string; label: string }) {
  const [shown, setShown] = useState(0);
  const gid = useId().replace(/:/g, '');
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.max(0, Math.min(100, pct))));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[9.5rem]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3B82F6" /><stop offset="55%" stopColor="#06B6D4" /><stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <circle cx="55" cy="55" r={r} fill="none" strokeWidth="10" className="stroke-neutral-200" />
        <circle cx="55" cy="55" r={r} fill="none" strokeWidth="10" strokeLinecap="round" stroke={`url(#g${gid})`}
          strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100}
          className="transition-[stroke-dashoffset] duration-1000 ease-out" />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <p className="text-base font-semibold tabular-nums text-neutral-900">{value}</p>
        <p className="text-[11px] text-neutral-500">{caption}</p>
      </div>
    </div>
  );
}
