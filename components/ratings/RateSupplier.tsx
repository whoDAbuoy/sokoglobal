'use client';

import { useState, useTransition } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { rateSupplier } from '@/app/dashboard/following/actions';

/** Interactive 1–5 stars for a buyer allowed to rate (can_rate_supplier). Saves at once; "Clear" removes the rating. */
export default function RateSupplier({ supplierId, initial }: { supplierId: string; initial: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const shown = hover ?? value ?? 0;

  function save(next: number | null) {
    const prev = value;
    setValue(next);
    start(async () => {
      const res = await rateSupplier(supplierId, next);
      if (!res.ok) { setValue(prev); toast.error(res.message); } else toast.success(res.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Your rating" className="flex" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} disabled={pending}
            onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onBlur={() => setHover(null)} onClick={() => save(n)}
            className="press rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895] disabled:opacity-60">
            <Star className={clsx('h-6 w-6 transition-colors', n <= shown ? 'fill-amber-300 text-amber-300' : 'text-neutral-600')} strokeWidth={1.5} aria-hidden />
          </button>
        ))}
      </div>
      {value !== null && !pending && (
        <button type="button" onClick={() => save(null)} className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline">Clear</button>
      )}
    </div>
  );
}
