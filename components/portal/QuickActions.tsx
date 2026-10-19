import Link from 'next/link';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

export interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon chip, e.g. 'tone-transit'. */
  tone: string;
  badge?: number;
}

/** One-click shortcut row. Tiles slide up on hover/focus (transform only; reduced motion disables it). */
export default function QuickActions({ actions, label = 'Quick actions', className }: { actions: QuickAction[]; label?: string; className?: string }) {
  return (
    <nav aria-label={label} className={clsx('grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]', className)}>
      {actions.map(({ href, label: text, hint, icon: Icon, tone, badge }) => (
        <Link key={href + text} href={href}
          className="group relative flex items-center gap-3 rounded-xl border border-neutral-200 bg-white/70 p-3 backdrop-blur-md transition dark:border-snow/10 dark:bg-midnight/70 duration-300 ease-out
            hover:-translate-y-1 hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.98]">
          <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-transform duration-300 group-hover:scale-110', tone)}>
            <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-neutral-900">{text}</span>
            <span className="block truncate text-xs text-neutral-500">{hint}</span>
          </span>
          {badge ? (
            <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold tabular-nums text-snow">{badge > 99 ? '99+' : badge}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
