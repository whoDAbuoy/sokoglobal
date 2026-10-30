'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { LayoutGrid, List, Rows3 } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { DEFAULT_PRODUCT_LAYOUT, LAYOUT_CONTAINER, PRODUCT_LAYOUT_KEY, parseProductLayout } from '@/lib/product-layout';
import TrialBatchCard, { type CardLayout } from './TrialBatchCard';

const OPTIONS: { layout: CardLayout; label: string; Icon: typeof Rows3 }[] = [
  { layout: 'detailed', label: 'Detailed', Icon: Rows3 },
  { layout: 'grid', label: 'Grid', Icon: LayoutGrid },
  { layout: 'list', label: 'List', Icon: List },
];

/** Detailed / Grid / List switch for a product list; the choice is remembered in this browser. */
export function useProductLayout(): [CardLayout, (l: CardLayout) => void] {
  const [layout, setLayout] = useState<CardLayout>(DEFAULT_PRODUCT_LAYOUT);
  useEffect(() => {
    try { setLayout(parseProductLayout(window.localStorage.getItem(PRODUCT_LAYOUT_KEY))); } catch { /* storage blocked */ }
  }, []);
  const choose = (l: CardLayout) => {
    setLayout(l);
    try { window.localStorage.setItem(PRODUCT_LAYOUT_KEY, l); } catch { /* storage blocked */ }
  };
  return [layout, choose];
}

export function LayoutSwitcher({ layout, onChange, className }: { layout: CardLayout; onChange: (l: CardLayout) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Product view" className={clsx('inline-flex rounded-full border border-neutral-300 p-0.5', className)}>
      {OPTIONS.map(({ layout: l, label, Icon }) => (
        <button key={l} type="button" role="radio" aria-checked={layout === l} onClick={() => onChange(l)} title={`${label} view`}
          className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition',
            layout === l ? 'bg-[#ffffff] text-[#0a0a0a] shadow' : 'text-neutral-600 hover:text-neutral-900')}>
          <Icon className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** The product list with its own switcher on top (supplier pages). The catalogue places the switcher in its toolbar. */
export default function ProductResults({ products, className, toolbar }: {
  products: TrialProductView[]; className?: string;
  /** Rendered left of the switcher (e.g. the result count). */
  toolbar?: React.ReactNode;
}) {
  const [layout, setLayout] = useProductLayout();
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{toolbar}</div>
        <LayoutSwitcher layout={layout} onChange={setLayout} />
      </div>
      <div className={clsx('mt-4', LAYOUT_CONTAINER[layout])}>
        {products.map((p) => <TrialBatchCard key={p.id} product={p} layout={layout} />)}
      </div>
    </div>
  );
}
