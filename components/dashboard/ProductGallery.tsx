'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';
import ProductVisual from './ProductVisual';

/**
 * Horizontal swipe gallery built on CSS scroll-snap: native touch swipe and
 * trackpad scrolling, while vertical page scrolling stays with the browser
 * (no touch handlers, no `touch-action` override). Dots/arrows follow the
 * scroll position, so every way of moving the gallery keeps them in sync.
 */
export default function ProductGallery({ images, alt, category, className, arrows = false }: {
  images: string[];
  alt: string;
  category: ProductCategory;
  /** Sizing for each slide, e.g. "aspect-square". */
  className?: string;
  /** Show previous/next buttons (always on in Quick View; on hover in cards). */
  arrows?: boolean | 'hover';
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const slides: (string | null)[] = images.length ? images : [null];
  const multi = slides.length > 1;

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !multi) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [multi]);

  const go = useCallback((index: number) => {
    const el = trackRef.current;
    if (!el) return;
    const n = (index + slides.length) % slides.length;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: n * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  }, [slides.length]);

  // Controls sit inside clickable cards: don't let them open the Quick View.
  const control = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  }

  return (
    <div className="group/gallery relative h-full" aria-roledescription={multi ? 'carousel' : undefined} aria-label={multi ? `${alt} photos` : undefined}>
      <div ref={trackRef} tabIndex={multi ? 0 : undefined} onKeyDown={multi ? onKeyDown : undefined}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900">
        {slides.map((src, i) => (
          <div key={src ?? i} className="h-full w-full shrink-0 snap-center snap-always"
            role={multi ? 'group' : undefined} aria-roledescription={multi ? 'slide' : undefined}
            aria-label={multi ? `${i + 1} of ${slides.length}` : undefined}>
            <ProductVisual src={src} alt={i === 0 ? alt : `${alt} — photo ${i + 1}`} category={category} className={className} />
          </div>
        ))}
      </div>

      {multi && arrows && (
        <>
          {([['prev', -1, ChevronLeft, 'left-3'], ['next', 1, ChevronRight, 'right-3']] as const).map(([label, step, Icon, side]) => (
            <button key={label} type="button" onClick={control(() => go(active + step))}
              aria-label={label === 'prev' ? 'Previous photo' : 'Next photo'}
              className={clsx('absolute top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-card ring-1 ring-black/5 backdrop-blur transition hover:bg-white',
                side, arrows === 'hover' && 'opacity-0 focus-visible:opacity-100 group-hover/gallery:opacity-100')}>
              <Icon className="h-4 w-4" strokeWidth={2} />
            </button>
          ))}
        </>
      )}

      {multi && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-neutral-900/30 px-2 py-1.5 backdrop-blur-sm">
            {slides.map((_, i) => (
              <button key={i} type="button" onClick={control(() => go(i))} aria-label={`Show photo ${i + 1}`} aria-current={i === active}
                className={clsx('h-1.5 rounded-full transition-all duration-300 ease-out',
                  i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90')} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
