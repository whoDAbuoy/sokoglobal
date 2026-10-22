'use client';

import { useEffect } from 'react';
import { THEME_KEY, resolveTheme } from '@/lib/theme';
import { applyTheme, readThemePreference } from '@/hooks/useTheme';

/**
 * Keeps <html> in the theme the user chose for the whole visit. THEME_INIT_SCRIPT
 * sets it before first paint; this guards it afterwards:
 *  - restores the `dark` class if anything removes it (e.g. a client re-render of the root),
 *  - follows the OS live when the preference is "system" (not only while Settings is open),
 *  - follows a theme change made in another tab.
 */
export default function ThemeSync() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const wantsDark = () => resolveTheme(readThemePreference(), mq.matches) === 'dark';
    const sync = () => { if (root.classList.contains('dark') !== wantsDark()) applyTheme(readThemePreference()); };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    const onSystem = () => { if (readThemePreference() === 'system') applyTheme('system', true); };
    const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY) applyTheme(readThemePreference(), true); };
    mq.addEventListener('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => { observer.disconnect(); mq.removeEventListener('change', onSystem); window.removeEventListener('storage', onStorage); };
  }, []);
  return null;
}
