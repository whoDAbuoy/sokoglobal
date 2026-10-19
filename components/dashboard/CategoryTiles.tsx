import Link from 'next/link';
import clsx from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';
import ProductVisual from './ProductVisual';

export interface CategoryTile {
  key: string;
  label: string;
  caption: string;
  href: string;
  image: string | null;
  category: ProductCategory;
  active?: boolean;
}

/** Category showcase: image tiles with a dark gradient caption and a slow zoom on hover. */
export default function CategoryTiles({ tiles }: { tiles: CategoryTile[] }) {
  return (
    <div className={clsx('grid gap-4', tiles.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {tiles.map((t) => (
        <Link key={t.key} href={t.href} scroll={false} aria-current={t.active ? 'page' : undefined}
          className={clsx('group/tile relative block aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2',
            t.active && 'ring-2 ring-neutral-900 ring-offset-2')}>
          <div className="absolute inset-0">
            <ProductVisual src={t.image} alt="" category={t.category}
              className="h-full w-full transition-transform duration-700 ease-out group-hover/tile:scale-110 motion-reduce:transition-none" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/80 via-neutral-950/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 text-white">
            <div>
              <p className="text-lg font-semibold leading-tight">{t.label}</p>
              <p className="mt-0.5 text-xs text-white/75">{t.caption}</p>
            </div>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur transition group-hover/tile:bg-white group-hover/tile:text-neutral-900">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
