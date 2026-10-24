'use client';

import { useEffect, useState } from 'react';

/** True while `query` matches. Always false on the server and the first client render (no hydration mismatch). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * The visible part of the page while `active`: on iOS the on-screen keyboard shrinks only the
 * visual viewport (the layout viewport and 100dvh stay full height), so a full-screen panel sized
 * from this keeps its composer above the keyboard. null when unsupported or inactive (fall back to 100dvh).
 */
export function useVisualViewport(active: boolean): { height: number; offsetTop: number } | null {
  const [box, setBox] = useState<{ height: number; offsetTop: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) { setBox(null); return; }
    const update = () => setBox({ height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [active]);
  return box;
}
