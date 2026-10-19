'use client';

import { useEffect, useState } from 'react';

/**
 * 270° progress ring that animates from 0 to `pct` on mount.
 * Respects prefers-reduced-motion (no transition).
 */
export default function ProgressGauge({ pct, value, caption, label }: {
  pct: number; value: string; caption: string; label: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.min(100, Math.max(0, pct))));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const r = 52;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75;
  const offset = arc - (arc * shown) / 100;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[11rem]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <svg viewBox="0 0 120 120" className="h-full w-full rotate-[135deg]" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" strokeLinecap="round"
          className="stroke-neutral-200" strokeDasharray={`${arc} ${circumference}`} />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" strokeLinecap="round"
          className="stroke-neutral-900 transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
          strokeDasharray={`${arc} ${circumference}`} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <p className="text-lg font-semibold tabular-nums text-neutral-900">{value}</p>
        <p className="text-[11px] text-neutral-500">{caption}</p>
      </div>
    </div>
  );
}
