'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useReducedMotion } from './useMotionLoop';

/**
 * Cycles through words with a blur-fade (the "flip words" effect). All words
 * share one grid cell so the line never changes width. Screen readers get the
 * first word only (no live churn); reduced motion shows it statically.
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

  return (
    <span className={clsx('inline-grid', className)}>
      <span className="sr-only">{words[0]}</span>
      {words.map((w, k) => (
        <span key={w} aria-hidden
          className={clsx('col-start-1 row-start-1 whitespace-nowrap', wordClassName,
            k === i ? 'animate-word-in' : 'invisible')}>
          {w}
        </span>
      ))}
    </span>
  );
}
