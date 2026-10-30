'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Compass, LifeBuoy, X } from 'lucide-react';
import { tourById, tourFor, tourSeenKey, type Tour, type TourStep } from '@/lib/tours';

const PAD = 8;            // spotlight padding around the target
const AUTO_DELAY = 900;   // let the page settle (and any prompt open) before a first-visit tour starts

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const seen = (t: Tour) => { try { return localStorage.getItem(tourSeenKey(t)) === '1'; } catch { return true; } };
const markSeen = (t: Tour) => { try { localStorage.setItem(tourSeenKey(t), '1'); } catch { /* storage blocked */ } };

/** The step's element, if it is on the page and visible. */
function targetOf(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`);
  return el && el.getClientRects().length > 0 ? el : null;
}

/**
 * Guide button + the guided tour for the current page (lib/tours.ts). Rendered in the portal header's section row.
 * A tour plays once per browser on a first visit (unless another dialog is open), from `?tour=<id>` (Help Center
 * "Show me"), or from the Guide button. Steps whose element isn't on the page are skipped.
 */
export default function TourRunner({ role }: { role: string }) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const router = useRouter();
  const tour = tourFor(pathname, role);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);

  const start = useCallback(() => {
    if (!tour) return;
    const available = tour.steps.filter((s) => !s.target || targetOf(s));
    if (available.length) { setIndex(0); setSteps(available); }
  }, [tour]);

  const finish = useCallback(() => {
    if (tour) markSeen(tour);
    setSteps(null);
  }, [tour]);

  // First visit, or ?tour=<id> from the Help Center.
  useEffect(() => {
    if (!tour) return;
    const asked = tourById(params.get('tour'))?.id === tour.id;
    if (!asked && seen(tour)) return;
    const timer = window.setTimeout(() => {
      if (document.querySelector('[aria-modal="true"]')) return;   // a prompt is open: try again on the next visit
      start();
      if (asked) {
        const url = new URL(window.location.href);
        url.searchParams.delete('tour');
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      }
    }, AUTO_DELAY);
    return () => window.clearTimeout(timer);
  }, [tour, params, start, router]);

  // A new page closes a tour left open.
  useEffect(() => { setSteps(null); }, [pathname]);

  return (
    <>
      <span className="flex shrink-0 items-center gap-1.5">
        {tour && (
          <button type="button" data-tour="tour-button" onClick={start} className="sx-tab press inline-flex items-center gap-1.5"
            title={`Show me around: ${tour.title}`}>
            <Compass className="h-4 w-4" aria-hidden /> Guide
          </button>
        )}
        <Link href="/help" className="sx-tab press inline-flex items-center gap-1.5" aria-current={pathname === '/help' ? 'page' : undefined}>
          <LifeBuoy className="h-4 w-4" aria-hidden /> Help
        </Link>
      </span>
      {steps && tour && (
        <TourOverlay tour={tour} steps={steps} index={index} onIndex={setIndex} onClose={finish} />
      )}
    </>
  );
}

function TourOverlay({ tour, steps, index, onIndex, onClose }: {
  tour: Tour; steps: TourStep[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [phone, setPhone] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(0);

  // Bring the target into view, then keep the spotlight on it through scrolls and resizes.
  useLayoutEffect(() => {
    const el = targetOf(step);
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setRect(el ? el.getBoundingClientRect() : null);
        setPhone(window.innerWidth < 640);
        setCardHeight(card.current?.offsetHeight ?? 0);
      });
    };
    measure();
    const settle = window.setTimeout(measure, reducedMotion() ? 0 : 450);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => { nextRef.current?.focus(); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !last) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, onClose, onIndex]);

  // Card position: under the target if it fits, else above, else centred. Phones use a bottom sheet.
  const style: React.CSSProperties = {};
  if (!phone && rect) {
    const width = Math.min(360, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    const below = rect.bottom + PAD + 12;
    const above = rect.top - PAD - 12 - cardHeight;
    style.width = width;
    style.left = left;
    style.top = below + cardHeight < window.innerHeight - 16 ? below : above > 16 ? above : Math.max(16, (window.innerHeight - cardHeight) / 2);
  }

  const labelId = `tour-${tour.id}-title`;
  return createPortal(
    <div className="dark sellsy fixed inset-0 z-[80]" data-tour-overlay>
      {/* The dim layer with a cut-out around the target (or plain dim for a centred step). Clicks never reach the page. */}
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-xl ring-2 ring-[#8fd3cc] transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)' }} />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/60" />
      )}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      <div ref={card} role="dialog" aria-modal="true" aria-labelledby={labelId}
        className={clsx('card fixed z-[81] p-5 text-neutral-900 shadow-2xl',
          phone ? 'inset-x-3 bottom-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]'
            : !rect ? 'left-1/2 top-1/2 w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2' : '')}
        style={phone || !rect ? undefined : style}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{tour.title} · {index + 1} of {steps.length}</p>
          <button type="button" onClick={onClose} aria-label="Close the tour" className="-m-1 rounded-full p-1 text-neutral-500 hover:text-neutral-900">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id={labelId} className="mt-1.5 text-base font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {steps.map((_, i) => <span key={i} className={clsx('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-[#8fd3cc]' : 'w-1.5 bg-neutral-300')} />)}
          </div>
          <div className="flex items-center gap-2">
            {index > 0
              ? <button type="button" onClick={() => onIndex(index - 1)} className="btn-secondary px-3 py-1.5 text-xs"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back</button>
              : <button type="button" onClick={onClose} className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900">Skip tour</button>}
            <button ref={nextRef} type="button" onClick={() => (last ? onClose() : onIndex(index + 1))}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff] px-3.5 py-1.5 text-xs font-medium text-[#0a0a0a] hover:opacity-90">
              {last ? 'Got it' : <>Next <ArrowRight className="h-3.5 w-3.5" aria-hidden /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
