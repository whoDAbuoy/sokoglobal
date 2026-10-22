'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY, parseTheme, resolveTheme, type ThemePreference } from '@/lib/theme';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Apply a preference to <html>: the `dark` class plus `color-scheme` (same as THEME_INIT_SCRIPT). */
export function applyTheme(pref: ThemePreference, animate = false) {
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 300);
  }
  const dark = resolveTheme(pref, media().matches) === 'dark';
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** The stored preference ('system' when unset or storage is blocked). */
export function readThemePreference(): ThemePreference {
  try { return parseTheme(localStorage.getItem(THEME_KEY)); } catch { return 'system'; }
}

/** Theme preference with a smooth switch; "system" follows the OS live. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const mq = media();
    const onChange = () => applyTheme('system', true);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still applies for this page */ }
    applyTheme(next, true);
  }, []);

  return { preference, setTheme };
}
