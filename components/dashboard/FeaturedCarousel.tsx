'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';
import ProductVisual from './ProductVisual';

export interface FeaturedSlide {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  image: string | null;
  category: ProductCategory;
}

const INTERVAL_MS = 6000;

/**
 * Featured collections banner: crossfading slides, edge arrows that fade in on
 * hover, animated dots. Auto-advances unless hovered/focused or the user
 * prefers reduced motion.
 */
export default function FeaturedCarousel({ slides }: { slides: FeaturedSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const multi = slides.length > 1;
  const go = useCallback((i: number) => setIndex((i + slides.length) % slides.length), [slides.length]);

  useEffect(() => {
    if (!multi || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [multi, paused, slides.length]);

  if (slides.length === 0) return null;

  return (
    <section aria-roledescription="carousel" aria-label="Featured collections"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      className="group/banner relative h-[22rem] overflow-hidden rounded-lg bg-neutral-900 sm:h-[26rem]">
      {slides.map((s, i) => (
        <div key={s.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`} aria-hidden={i !== index}
          className={clsx('absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none',
            i === index ? 'z-10 opacity-100' : 'pointer-events-none opacity-0')}>
          <ProductVisual src={s.image} alt="" category={s.category}
            className={clsx('h-full w-full transition-transform duration-[6000ms] ease-out motion-reduce:transition-none', i === index ? 'scale-105' : 'scale-100')} />
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/85 via-neutral-950/55 to-neutral-950/10" />
          <div className="absolute inset-0 flex items-end p-6 sm:items-center sm:p-12">
            <div className="max-w-md text-white">
              <p className="text-xs font-medium uppercase tracking-eyebrow text-white/70">{s.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">{s.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-white/80">{s.body}</p>
              <Link href={s.href} tabIndex={i === index ? 0 : -1}
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-100">
                {s.cta} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      ))}

      {multi && (
        <>
          {([['Previous slide', -1, ChevronLeft, 'left-4'], ['Next slide', 1, ChevronRight, 'right-4']] as const).map(([label, step, Icon, side]) => (
            <button key={label} type="button" onClick={() => go(index + step)} aria-label={label}
              className={clsx('absolute top-1/2 z-20 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-overlay transition duration-300',
                'opacity-0 hover:bg-white focus-visible:opacity-100 group-hover/banner:opacity-100 [@media(hover:none)]:opacity-100', side)}>
              <Icon className="h-5 w-5" />
            </button>
          ))}
          <div className="absolute bottom-5 right-6 z-20 flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button key={s.id} type="button" onClick={() => go(i)} aria-label={`Show slide ${i + 1}`} aria-current={i === index}
                className={clsx('h-1.5 rounded-full transition-all duration-500 ease-out', i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80')} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
