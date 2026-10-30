/** Product list layouts (components/dashboard/ProductResults.tsx), pure. */
import type { CardLayout } from '@/components/dashboard/TrialBatchCard';

export const PRODUCT_LAYOUTS: readonly CardLayout[] = ['detailed', 'grid', 'list'];
export const DEFAULT_PRODUCT_LAYOUT: CardLayout = 'detailed';
/** Remembered per browser (localStorage): a viewing preference, nothing else depends on it. */
export const PRODUCT_LAYOUT_KEY = 'sg-product-layout';

export const parseProductLayout = (v: unknown): CardLayout =>
  typeof v === 'string' && (PRODUCT_LAYOUTS as readonly string[]).includes(v) ? (v as CardLayout) : DEFAULT_PRODUCT_LAYOUT;

/** Container classes per layout: detailed keeps the original grid; grid is two-up on phones; list is one column. */
export const LAYOUT_CONTAINER: Record<CardLayout, string> = {
  detailed: 'grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
  grid: 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  list: 'grid gap-3 xl:grid-cols-2',
};
