'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY, parseTheme, resolveTheme, type ThemePreference } from '@/lib/theme';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply(pref: ThemePreference, animate: boolean) {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 300);
  }
  root.classList.toggle('dark', resolveTheme(pref, media().matches) === 'dark');
}

/** Theme preference with a smooth switch; "system" follows the OS live. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* storage blocked */ }
    setPreference(parseTheme(stored));
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = media();
    const onChange = () => apply('system', true);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still applies for this page */ }
    apply(next, true);
  }, []);

  return { preference, setTheme };
}
