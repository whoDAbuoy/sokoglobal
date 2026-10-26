'use client';

import { Children, useState, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Card grid that shows exactly one row — 1 card on phones, 2 from sm, 3 from lg, 4 from 2xl — and hides the rest
 * with CSS only (no measuring, no layout shift). When there are more cards than fit, a "View all" link goes to the
 * full list (`moreHref`), or, without one, "View more" expands the grid in place.
 */
const ITEM_VISIBILITY = ['flex', 'hidden sm:flex', 'hidden lg:flex', 'hidden 2xl:flex'] as const;

/** Show the "more" control only at widths where some cards are hidden (literal classes for Tailwind). */
function moreVisibility(count: number): string {
  if (count <= 1) return 'hidden';
  if (count === 2) return 'flex sm:hidden';
  if (count === 3) return 'flex lg:hidden';
  if (count === 4) return 'flex 2xl:hidden';
  return 'flex';
}

export default function OneRowGrid({ children, moreHref, moreLabel = 'View all', className }: {
  children: ReactNode; moreHref?: string; moreLabel?: string; className?: string;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, ITEM_VISIBILITY.length);

  return (
    <div className={className}>
      <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {shown.map((child, i) => (
          <div key={i} className={clsx('min-w-0 flex-col [&>*]:flex-1', expanded ? 'flex' : ITEM_VISIBILITY[i])}>{child}</div>
        ))}
      </div>
      <div className={clsx('mt-6 justify-center', expanded ? 'flex' : moreVisibility(items.length))}>
        {moreHref ? (
          <Link href={moreHref} className="btn-secondary px-5 py-2.5 active:scale-95">
            {moreLabel} <span className="tabular-nums text-neutral-500">({items.length})</span> <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="btn-secondary px-5 py-2.5 active:scale-95">
            {expanded ? <>Show less <ChevronUp className="h-4 w-4" aria-hidden /></> : <>View more <span className="tabular-nums text-neutral-500">({items.length})</span> <ChevronDown className="h-4 w-4" aria-hidden /></>}
          </button>
        )}
      </div>
    </div>
  );
}
