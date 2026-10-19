'use client';

import { useEffect, useState, type RefObject } from 'react';

/** True when the user asked the OS for reduced motion (live). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

/** True on small or touch-first screens (used to lighten canvas work). */
export function useLowPowerScreen(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px), (pointer: coarse)');
    const sync = () => setLow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return low;
}

/**
 * requestAnimationFrame loop that only runs while the element is on screen and
 * the tab is visible. With reduced motion it draws a single still frame.
 * `draw(timeMs)` must be stable (wrap in useCallback or a ref).
 * `maxFps` caps the frame rate (e.g. 30 on phones, where frosted panels re-blur every frame).
 */
export function useMotionLoop(ref: RefObject<Element | null>, draw: (t: number) => void, reduced: boolean, maxFps = 60) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let onScreen = true;
    let start = performance.now();
    let pausedAt = 0;
    let last = 0;
    const minGap = 1000 / Math.max(1, maxFps) - 1;

    const frame = (now: number) => {
      if (now - last >= minGap) { last = now; draw(now - start); }
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (raf || reduced || !onScreen || document.hidden) return;
      if (pausedAt) { start += performance.now() - pausedAt; pausedAt = 0; }
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf); raf = 0; pausedAt = performance.now();
    };

    draw(reduced ? 4000 : 0);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      if (onScreen) run(); else stop();
    });
    io.observe(el);
    const onVis = () => (document.hidden ? stop() : run());
    document.addEventListener('visibilitychange', onVis);
    run();
    return () => { stop(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [ref, draw, reduced, maxFps]);
}
