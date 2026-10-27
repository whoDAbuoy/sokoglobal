'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useReducedMotion } from './useMotionLoop';

/**
 * Cycles through words with a blur-fade (the "flip words" effect). All words share one grid cell so
 * the line never changes width. Only the first word is real text: it is what search engines index and
 * screen readers announce ("Global trade that feels effortless"), with no live churn. The other words
 * are painted from a data attribute by CSS (::before content), so they never join the page text: before,
 * crawlers read every word run together ("effortlesseffortlessborderlessalive"). Reduced motion shows
 * the first word statically.
 */
export default function RotatingWord({ words, interval = 2600, className, wordClassName }: {
  words: string[]; interval?: number; className?: string;
  /** Applied to each word (put gradient text here: background-clip must sit on the animated element). */
  wordClassName?: string;
}) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced || words.length < 2) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => window.clearInterval(id);
  }, [reduced, words.length, interval]);

  const [first, ...rest] = words;
  return (
    <span className={clsx('inline-grid', className)}>
      <span className={clsx('col-start-1 row-start-1 whitespace-nowrap', wordClassName, i === 0 ? 'animate-word-in' : 'invisible')}>
        {first}
      </span>
      {rest.map((w, k) => (
        <span key={w} aria-hidden data-word={w}
          className={clsx('col-start-1 row-start-1 whitespace-nowrap before:content-[attr(data-word)]', wordClassName,
            k + 1 === i ? 'animate-word-in' : 'invisible')} />
      ))}
    </span>
  );
}
