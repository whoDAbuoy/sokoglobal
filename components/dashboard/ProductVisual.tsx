import Image from 'next/image';
import clsx from 'clsx';
import { Shirt, Sparkles } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';

/** Real product photo when available; otherwise a branded category placeholder. */
export default function ProductVisual({ src, alt, category, className }: {
  src: string | null; alt: string; category: ProductCategory; className?: string;
}) {
  if (src) {
    return (
      <div className={clsx('relative overflow-hidden bg-neutral-100', className)}>
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 33vw, 100vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
      </div>
    );
  }
  const Icon = category === 'beauty' ? Sparkles : Shirt;
  return (
    <div className={clsx('grid place-items-center bg-neutral-100', className)}>
      <Icon className="h-10 w-10 text-neutral-300" strokeWidth={1.25} />
    </div>
  );
}
