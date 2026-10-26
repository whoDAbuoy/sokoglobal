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
 * Featured collections banner: crossfading slides with the copy on the left and the product visual clear on the
 * right. Previous / next and the slide dots sit in one small control row under the copy (nothing floats over the
 * image). Auto-advances unless hovered/focused or the user prefers reduced motion.
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
      className="group/banner relative h-[22rem] overflow-hidden rounded-lg bg-black sm:h-[26rem]">
      {slides.map((s, i) => (
        <div key={s.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`} aria-hidden={i !== index}
          className={clsx('absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none',
            i === index ? 'z-10 opacity-100' : 'pointer-events-none opacity-0')}>
          <ProductVisual src={s.image} alt="" category={s.category}
            className={clsx('h-full w-full transition-transform duration-[6000ms] ease-out motion-reduce:transition-none', i === index ? 'scale-105' : 'scale-100')} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10" />
          <div className="absolute inset-0 flex items-end p-6 pb-16 sm:items-center sm:p-12 sm:pb-12">
            <div className="max-w-md text-[#fff]">
              <p className="text-xs font-medium uppercase tracking-eyebrow text-[#fff]/70">{s.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">{s.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-[#fff]/80">{s.body}</p>
              <Link href={s.href} tabIndex={i === index ? 0 : -1}
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#fff] px-4 py-2.5 text-sm font-medium text-[#171717] transition hover:bg-[#f5f5f5]">
                {s.cta} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      ))}

      {multi && (
        // Controls under the copy, left side only: the product visual on the right stays unobstructed.
        <div className="absolute bottom-5 left-6 z-20 flex items-center gap-2 sm:left-12">
          {([['Previous slide', -1, ChevronLeft], ['Next slide', 1, ChevronRight]] as const).map(([label, step, Icon]) => (
            <button key={label} type="button" onClick={() => go(index + step)} aria-label={label}
              className="grid h-8 w-8 place-items-center rounded-full border border-[#fff]/25 bg-[#000]/30 text-[#fff] backdrop-blur-md transition hover:bg-[#000]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#fff]">
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <div className="ml-1 flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button key={s.id} type="button" onClick={() => go(i)} aria-label={`Show slide ${i + 1}`} aria-current={i === index}
                className={clsx('h-1.5 rounded-full transition-all duration-500 ease-out', i === index ? 'w-6 bg-[#fff]' : 'w-1.5 bg-[#fff]/50 hover:bg-[#fff]/80')} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
