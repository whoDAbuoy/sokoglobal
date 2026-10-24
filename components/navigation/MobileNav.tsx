'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Compass, House, MessageSquare, Package, UserRound, type LucideIcon } from 'lucide-react';
import { useChat } from '@/context/ChatContext';
import type { Profile } from '@/lib/types';
import { roleAdminLevel } from '@/lib/auth/admin-access';

type Item = { label: string; href: string; icon: LucideIcon; badge?: boolean };

/** Thumb-reach destinations per role: Home, Explore, Messages, Orders, Profile. */
function itemsFor(profile: Profile): Item[] {
  const profileItem: Item = { label: 'Profile', href: '/dashboard/settings', icon: UserRound };
  if (roleAdminLevel(profile.role)) {
    return [
      { label: 'Home', href: '/admin', icon: House },
      { label: 'Explore', href: '/admin/products', icon: Compass },
      { label: 'Messages', href: profile.role === 'super_admin' ? '/admin/messages' : '/admin/support', icon: MessageSquare, badge: true },
      { label: 'Orders', href: '/admin/orders', icon: Package },
      profileItem,
    ];
  }
  if (profile.role === 'supplier') {
    return [
      { label: 'Home', href: '/supplier', icon: House },
      { label: 'Explore', href: '/supplier/rfqs', icon: Compass },
      { label: 'Messages', href: '/supplier/messages', icon: MessageSquare, badge: true },
      { label: 'Orders', href: '/supplier/orders', icon: Package },
      profileItem,
    ];
  }
  return [
    { label: 'Home', href: '/dashboard', icon: House },
    { label: 'Explore', href: '/dashboard/discover', icon: Compass },
    { label: 'Messages', href: '/dashboard/messages', icon: MessageSquare, badge: true },
    { label: 'Orders', href: '/dashboard/orders', icon: Package },
    profileItem,
  ];
}

/** The item for the current page: the longest href the path sits under (so /dashboard/orders marks Orders, not Home). */
function activeHref(items: Item[], pathname: string): string | null {
  const hits = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/**
 * iOS-style glass tab dock for phones (hidden from md up). `data-mobile-dock` lets globals.css pad the
 * page so the dock never covers content, and hide the dock while a full-screen chat is open.
 */
export default function MobileNav({ profile }: { profile: Profile }) {
  const pathname = usePathname() ?? '';
  const { unreadCount, adminUnreadCount } = useChat();
  const unread = unreadCount + adminUnreadCount;
  const items = itemsFor(profile);
  const current = activeHref(items, pathname);

  return (
    <nav data-mobile-dock aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-50 block border-t border-black/[0.06] bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl dark:border-snow/10 dark:bg-gray-950/80 md:hidden">
      <ul className="mx-auto flex h-16 max-w-md items-stretch justify-around px-2">
        {items.map(({ label, href, icon: Icon, badge }) => {
          const active = href === current;
          return (
            <li key={label} className="flex flex-1">
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={clsx('press relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  active ? 'text-blue-600 dark:text-cyan-400' : 'text-neutral-500')}>
                <span className={clsx('grid h-8 w-12 place-items-center rounded-full transition-colors duration-200', active && 'bg-blue-500/10 dark:bg-cyan-400/10')}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                </span>
                {label}
                {badge && unread > 0 && (
                  <span aria-label={`${unread} unread`}
                    className="absolute right-[calc(50%-1.375rem)] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold tabular-nums text-snow ring-2 ring-white dark:ring-gray-950">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
