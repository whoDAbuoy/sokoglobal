import clsx from 'clsx';
import { Star, StarHalf } from 'lucide-react';
import { ratingLabel, starFills } from '@/lib/ratings';

/** Read-only stars (nearest half) with "4.5 · 12 ratings". */
export default function StarRating({ average, count, size = 'sm', showLabel = true, className }: {
  average: number | null; count: number; size?: 'sm' | 'md'; showLabel?: boolean; className?: string;
}) {
  const px = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const label = ratingLabel(average, count);
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)} title={label}>
      <span className="relative inline-flex" role="img" aria-label={count ? `Rated ${average?.toFixed(1)} out of 5 from ${count} rating${count === 1 ? '' : 's'}` : 'No ratings yet'}>
        {starFills(average).map((f, i) => (
          <span key={i} className="relative">
            <Star className={clsx(px, 'text-neutral-600')} strokeWidth={1.5} aria-hidden />
            {f !== 'empty' && (
              <span className="absolute inset-0">
                {f === 'full'
                  ? <Star className={clsx(px, 'fill-amber-300 text-amber-300')} strokeWidth={1.5} aria-hidden />
                  : <StarHalf className={clsx(px, 'fill-amber-300 text-amber-300')} strokeWidth={1.5} aria-hidden />}
              </span>
            )}
          </span>
        ))}
      </span>
      {showLabel && <span className="text-xs tabular-nums text-neutral-500">{label}</span>}
    </span>
  );
}
