import Image from 'next/image';
import clsx from 'clsx';
import { Boxes, Shirt, Sparkles } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';

/**
 * Real product photo when available; otherwise a branded category placeholder.
 * `fit="contain"` shows the whole photo (no crop) — for wide banners, where cover would slice a portrait shot
 * into an enlarged strip; `sizes` lets wide placements request a sharp enough source.
 */
export default function ProductVisual({ src, alt, category, className, fit = 'cover', sizes = '(min-width: 1024px) 33vw, 100vw', zoomOnHover = true }: {
  src: string | null; alt: string; category: ProductCategory; className?: string;
  fit?: 'cover' | 'contain'; sizes?: string; zoomOnHover?: boolean;
}) {
  if (src) {
    return (
      <div className={clsx('relative overflow-hidden bg-neutral-100', className)}>
        <Image src={src} alt={alt} fill sizes={sizes}
          className={clsx(fit === 'contain' ? 'object-contain' : 'object-cover',
            zoomOnHover && 'transition-transform duration-500 ease-out group-hover:scale-[1.03]')} />
      </div>
    );
  }
  const Icon = category === 'beauty' ? Sparkles : category === 'clothing' ? Shirt : Boxes;
  return (
    <div className={clsx('grid place-items-center bg-neutral-100', className)}>
      <Icon className="h-10 w-10 text-neutral-300" strokeWidth={1.25} />
    </div>
  );
}
