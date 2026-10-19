'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { parseVideoUrl } from '@/lib/video';
import type { GalleryMedia, ProductCategory } from '@/lib/types';
import ProductVisual from './ProductVisual';
import VideoSlide from './VideoSlide';

/**
 * Horizontal swipe gallery built on CSS scroll-snap: native touch swipe and
 * trackpad scrolling, while vertical page scrolling stays with the browser
 * (no touch handlers, no `touch-action` override). Dots/arrows follow the
 * scroll position, so every way of moving the gallery keeps them in sync.
 * Video slides (files, HLS, YouTube/Vimeo) play inline and pause when swiped away.
 * With a mouse, the strip can also be dragged; it snaps to the nearest slide on
 * release, and a drag never counts as a click on the card underneath.
 */
export default function ProductGallery({ images, media, alt, category, className, arrows = false, thumbnails = false, dotsClassName }: {
  images: string[];
  /** Photos and videos; takes precedence over `images` when non-empty. */
  media?: GalleryMedia[];
  alt: string;
  category: ProductCategory;
  /** Sizing for each slide, e.g. "aspect-square". */
  className?: string;
  /** Show previous/next buttons (always on in Quick View; on hover in cards). */
  arrows?: boolean | 'hover';
  /** Thumbnail strip (photos + video thumbnails) instead of dots — used in Quick View. */
  thumbnails?: boolean;
  /** Extra classes for the dots bar, e.g. to lift it above a card's hover toolbar. */
  dotsClassName?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const items: GalleryMedia[] = media?.length ? media : images.map((url) => ({ type: 'image' as const, url }));
  const slides: (GalleryMedia | null)[] = items.length ? items : [null];
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

  // Mouse drag-to-scroll. Snap is switched off while dragging and restored once the strip settles.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!multi || e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;          // a small wobble is still a click
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.currentTarget.scrollLeft = d.left - dx;
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    suppressClick.current = true;
    const el = e.currentTarget;
    const w = Math.max(1, el.clientWidth);
    const dx = e.clientX - d.x;
    const start = Math.round(d.left / w);
    const target = Math.min(slides.length - 1, Math.max(0, start + (dx < -w * 0.15 ? 1 : dx > w * 0.15 ? -1 : 0)));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target * w, behavior: reduce ? 'auto' : 'smooth' });
    window.setTimeout(() => setDragging(false), reduce ? 0 : 380);
  }

  // Controls sit inside clickable cards: don't let them open the Quick View.
  const control = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  }

  return (
    <div className="group/gallery relative h-full" aria-roledescription={multi ? 'carousel' : undefined} aria-label={multi ? `${alt} photos` : undefined}
      onClickCapture={(e) => { if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); e.preventDefault(); } }}>
      <div ref={trackRef} tabIndex={multi ? 0 : undefined} onKeyDown={multi ? onKeyDown : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDragStart={(e) => e.preventDefault()}
        className={clsx('no-scrollbar flex h-full overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900',
          dragging ? 'cursor-grabbing select-none snap-none' : 'snap-x snap-mandatory', multi && !dragging && 'cursor-grab')}>
        {slides.map((slide, i) => (
          <div key={slide?.url ?? i} className="h-full w-full shrink-0 snap-center snap-always"
            role={multi ? 'group' : undefined} aria-roledescription={multi ? 'slide' : undefined}
            aria-label={multi ? `${i + 1} of ${slides.length}` : undefined}>
            {slide?.type === 'video' ? (
              <VideoSlide url={slide.url} poster={slide.poster} title={`${alt} — video`} active={i === active} className={className} />
            ) : (
              <ProductVisual src={slide?.url ?? null} alt={i === 0 ? alt : `${alt} — photo ${i + 1}`} category={category} className={className} />
            )}
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

      {multi && thumbnails && (
        <div className="absolute inset-x-3 bottom-3 flex justify-center">
          <div className="no-scrollbar flex max-w-full snap-x gap-2 overflow-x-auto rounded-lg bg-neutral-900/30 p-1.5 backdrop-blur-sm">
            {slides.map((slide, i) => {
              const video = slide?.type === 'video';
              const thumb = video ? slide?.poster ?? (() => { const v = slide ? parseVideoUrl(slide.url) : null; return v?.kind === 'youtube' ? v.thumbnail : null; })() : slide?.url;
              return (
                <button key={slide?.url ?? i} type="button" onClick={control(() => go(i))}
                  aria-label={`Show ${video ? 'video' : 'photo'} ${i + 1}`} aria-current={i === active}
                  className={clsx('relative h-12 w-12 shrink-0 snap-start overflow-hidden rounded-md bg-neutral-800 ring-2 transition',
                    i === active ? 'ring-white' : 'ring-transparent opacity-70 hover:opacity-100')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />}
                  {video && <span className="absolute inset-0 grid place-items-center bg-black/30"><Play className="ml-0.5 h-4 w-4 fill-white text-white" /></span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {multi && !thumbnails && (
        <div className={clsx('pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-transform duration-300 ease-out', dotsClassName)}>
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-neutral-900/30 px-2 py-1.5 backdrop-blur-sm">
            {slides.map((_, i) => (
              <button key={i} type="button" onClick={control(() => go(i))} aria-label={`Show ${slides[i]?.type === 'video' ? 'video' : 'photo'} ${i + 1}`} aria-current={i === active}
                className={clsx('h-1.5 rounded-full transition-all duration-300 ease-out',
                  i === active ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90')} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
