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
      <div className={clsx('relative overflow-hidden bg-slate-100', className)}>
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" />
      </div>
    );
  }
  const Icon = category === 'beauty' ? Sparkles : Shirt;
  return (
    <div className={clsx('grid place-items-center',
      category === 'beauty' ? 'bg-gradient-to-br from-rose-50 via-white to-brand-50' : 'bg-gradient-to-br from-brand-50 via-white to-slate-100',
      className)}>
      <Icon className={clsx('h-10 w-10', category === 'beauty' ? 'text-rose-300' : 'text-brand-300')} strokeWidth={1.5} />
    </div>
  );
}
