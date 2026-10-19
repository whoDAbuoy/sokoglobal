'use client';

import { useId, useState } from 'react';
import { Info } from 'lucide-react';

/** Small accessible tooltip: shows on hover and keyboard focus, described via aria-describedby. Esc closes it. */
export default function InfoTip({ text, label = 'More info' }: { text: string; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded-full text-neutral-400 transition-colors hover:text-blue-500 focus:outline-none focus-visible:text-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500">
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span role="tooltip" id={id}
          className="absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 animate-fade-in frost-pop rounded-lg px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-neutral-700">
          {text}
        </span>
      )}
    </span>
  );
}
