'use client';

import clsx from 'clsx';
import { CheckCircle2, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import type { ThemePreference } from '@/lib/theme';

/** Light / dark / system theme (saved on this device). Moved unchanged from the old profile page. */
const THEMES: { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Bright surfaces, dark text' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes at night' },
  { value: 'system', label: 'System', icon: Monitor, hint: 'Follows your device setting' },
];

export default function AppearancePanel() {
  const { preference, setTheme } = useTheme();
  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-900">Theme</h3>
      <p className="mt-1 text-sm text-neutral-500">Saved on this device.</p>
      <div role="radiogroup" aria-label="Theme" className="mt-5 grid gap-4 sm:grid-cols-3">
        {THEMES.map(({ value, label, icon: Icon, hint }) => {
          const active = preference === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setTheme(value)}
              className={clsx('rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2',
                active ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200 hover:border-neutral-400')}>
              {/* Mini preview (fixed colours so it shows the target theme in either mode). */}
              <span aria-hidden className={clsx('flex h-20 overflow-hidden rounded-md border',
                value === 'dark' ? 'border-[#303030] bg-[#0c0c0c]' : value === 'light' ? 'border-[#e5e5e5] bg-[#ffffff]' : 'border-[#d4d4d4] bg-gradient-to-r from-[#ffffff] from-50% to-[#0c0c0c] to-50%')}>
                <span className="m-2 flex flex-1 flex-col gap-1.5">
                  <span className={clsx('h-2 w-1/2 rounded', value === 'dark' ? 'bg-[#f3f3f3]' : 'bg-[#171717]')} />
                  <span className={clsx('h-2 w-3/4 rounded', value === 'dark' ? 'bg-[#4a4a4a]' : 'bg-[#d4d4d4]')} />
                  <span className={clsx('mt-auto h-4 w-1/3 rounded', value === 'dark' ? 'bg-[#f3f3f3]' : 'bg-[#171717]')} />
                </span>
              </span>
              <span className="mt-3 flex items-center gap-2 text-sm font-medium text-neutral-900"><Icon className="h-4 w-4" /> {label}
                {active && <CheckCircle2 className="ml-auto h-4 w-4" />}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
