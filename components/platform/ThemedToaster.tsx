'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

const isDark = () => document.documentElement.classList.contains('dark');

/**
 * Sonner picks its text colours from its own `theme` (light by default), but
 * the app's dark mode is the `dark` class on <html> (lib/theme.ts), toggled
 * live from Settings. Following that class keeps toast text readable: without
 * it, dark-mode toasts showed light-theme (dark) text on a dark surface.
 */
export default function ThemedToaster() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme(isDark() ? 'dark' : 'light');
    const observer = new MutationObserver(() => setTheme(isDark() ? 'dark' : 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster closeButton position="top-right" theme={theme}
      toastOptions={{
        classNames: {
          toast: 'rounded-[18px] border shadow-overlay backdrop-blur-xl font-sans '
            + '!border-black/[0.08] !bg-white/95 !text-neutral-900 '
            + 'dark:!border-snow/15 dark:!bg-zinc-900/95 dark:!text-zinc-100',
          title: '!text-inherit font-medium',
          description: '!text-neutral-600 dark:!text-zinc-300',
          closeButton: '!border-black/10 !bg-white !text-neutral-700 dark:!border-snow/20 dark:!bg-zinc-800 dark:!text-zinc-100',
          actionButton: '!bg-blue-600 !text-white',
          cancelButton: '!bg-neutral-200 !text-neutral-900 dark:!bg-zinc-700 dark:!text-zinc-100',
        },
      }} />
  );
}
