'use client';

import Link from 'next/link';
import {
  BadgeCheck, Bell, ClipboardCheck, Compass, FileCheck2, Headphones, Heart, LayoutDashboard, LogOut, MessageSquare, Package,
  PackagePlus, ShieldCheck, ShieldHalf, ShoppingBag, Store, Truck, Undo2, UserCog, Users, Gauge, LayoutGrid, type LucideIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useChat } from '@/context/ChatContext';
import { useWishlist } from '@/hooks/useWishlist';
import type { Profile } from '@/lib/types';
import { ADMIN_LEVEL_LABEL, adminLevel, formatTimeLeft, homePathFor, roleAdminLevel } from '@/lib/auth/admin-access';

const ADMIN_NAV: [string, string][] = [['Overview', '/admin'], ['Review queue', '/admin/review'], ['Catalogue', '/admin/products'], ['Shipments', '/admin/orders'], ['Supplier KYC', '/admin/kyc'], ['Users', '/admin/users'], ['Support', '/admin/support']];
const NAV: Record<Profile['role'], [string, string][]> = {
  importer: [['Discover', '/dashboard'], ['Catalog', '/dashboard/discover'], ['Trend Pools', '/dashboard#pools'], ['Messages', '/dashboard/messages']],
  supplier: [['Catalogue', '/supplier'], ['Messages', '/supplier/messages'], ['New product', '/supplier/products/new'], ['Verification', '/supplier/verification']],
  admin: ADMIN_NAV,
  super_admin: ADMIN_NAV,
};

/**
 * Temporary (delegated) admins keep their own portal; inside /admin they get the
 * admin links. The Control room button (kill switch, overrides) is for permanent admins only.
 */
function navLinks(profile: Profile, pathname: string): [string, string][] {
  if (adminLevel(profile) !== 'delegated') return NAV[profile.role];
  return pathname.startsWith('/admin') ? [...ADMIN_NAV, ['My portal', homePathFor(profile.role)]] : [...NAV[profile.role], ['Admin', '/admin']];
}

/** Icon per nav label (decorative; the text label stays the accessible name). */
const NAV_ICON: Record<string, LucideIcon> = {
  Discover: Compass, 'Trend Pools': Users, Messages: MessageSquare, Catalogue: Store, 'New product': PackagePlus,
  Verification: FileCheck2, Overview: LayoutDashboard, 'Review queue': ClipboardCheck, Shipments: Truck,
  'Supplier KYC': BadgeCheck, Users: UserCog, Support: Headphones, Catalog: LayoutGrid, Control: Gauge, Admin: ShieldHalf,
  'My portal': Undo2,
};

export default function DashboardHeader({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const cart = useCart();
  const { unreadCount } = useChat();
  const saved = useWishlist().ids.length;
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const pathname = usePathname() ?? '';
  const level = adminLevel(profile);
  const wideNav = (level !== null && pathname.startsWith('/admin')) || roleAdminLevel(profile.role) !== null;
  const links = navLinks(profile, pathname).map(([label, href]) => {
    const Icon = NAV_ICON[label];
    return (
    <Link key={label} href={href}
      className="group/nav press inline-flex items-center gap-1.5 whitespace-nowrap rounded-md text-sm text-neutral-600 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      {Icon && <Icon className="h-4 w-4 text-neutral-400 transition-colors group-hover/nav:text-blue-500" strokeWidth={1.75} aria-hidden />}
      {label}
      {label === 'Messages' && unreadCount > 0 && (
        <span aria-label={`${unreadCount} unread`} className="grid h-4 min-w-4 place-items-center rounded-full bg-neutral-900 px-1 text-[10px] font-semibold tabular-nums text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
    );
  });

  return (
    <header className="sticky top-3 z-50 px-3 sm:top-4 sm:px-4">
      <div className="glass-toolbar mx-auto max-w-7xl">
      <div className="flex h-14 items-center justify-between gap-6 px-3 sm:h-16 sm:px-5">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-cyan-400" strokeWidth={2.25} aria-hidden />
            <span className="text-base font-semibold tracking-tight text-neutral-900">SokoGlobal</span>
          </Link>
          <nav className={wideNav ? 'hidden items-center gap-5 xl:flex' : 'hidden items-center gap-7 md:flex'}>{links}</nav>
        </div>

        <div className="flex items-center gap-1">
          {roleAdminLevel(profile.role) && (
            <Link href="/admin/control" aria-label="Control room: platform switches, overrides and audit log" title="Control room"
              className={`mr-0.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors sm:mr-1 sm:px-2.5 ${pathname.startsWith('/admin/control') ? 'border-neutral-900 text-neutral-900' : 'border-neutral-300 text-neutral-800 hover:border-neutral-900'}`}>
              <Gauge className="h-4 w-4" strokeWidth={1.75} aria-hidden /> <span className="hidden sm:inline">Control</span>
            </Link>
          )}
          {profile.role === 'importer' && (
            <Link href="/dashboard/orders" aria-label="My orders and escrow tracking"
              className="mr-0.5 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:border-neutral-900 sm:mr-1 sm:px-2.5">
              <Package className="h-4 w-4" strokeWidth={1.75} /> <span className="hidden sm:inline">My Orders</span>
            </Link>
          )}
          {profile.role === 'importer' && (
            <Link href="/dashboard/wishlist" aria-label={`Wishlist, ${saved} saved`}
              className="relative rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
              <Heart className="h-5 w-5" strokeWidth={1.75} />
              {saved > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white">
                  {saved > 99 ? '99+' : saved}
                </span>
              )}
            </Link>
          )}
          {profile.role === 'importer' && (
            <button type="button" onClick={() => cart.setOpen(true)} aria-label={`Cart, ${cart.items.length} item${cart.items.length === 1 ? '' : 's'}`}
              className="relative rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
              <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
              {cart.items.length > 0 && (
                <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-neutral-900 px-1 text-[10px] font-semibold tabular-nums text-white">
                  {cart.items.length}
                </span>
              )}
            </button>
          )}
          <button type="button" aria-label="Notifications" className="hidden rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900 sm:block">
            <Bell className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <Link href="/dashboard/settings" aria-label="Profile & settings" title="Profile & settings"
            className="ml-1 flex items-center gap-3 rounded-md border-l border-neutral-200 py-1 pl-2 pr-1 transition-colors hover:bg-neutral-50 sm:ml-2 sm:pl-4">
            <div className="hidden text-right sm:block">
              <p className="flex items-center justify-end gap-1 text-sm font-medium text-neutral-900">
                {profile.company_name}
                {profile.kyc_verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verified business" />}
              </p>
              <p className="text-xs text-neutral-500">
                {profile.full_name}
                {(level === 'super' || level === 'delegated') && (
                  <span className={level === 'super' ? 'ml-1.5 font-medium text-violet-700 dark:text-violet-300' : 'ml-1.5 font-medium text-amber-700 dark:text-amber-300'}>
                    · {ADMIN_LEVEL_LABEL[level]}{level === 'delegated' && profile.admin_access?.expires_at ? ` (${formatTimeLeft(profile.admin_access.expires_at)})` : ''}
                  </span>
                )}
              </p>
            </div>
            <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-xs font-semibold text-snow shadow-[0_4px_14px_-4px_rgb(59_130_246/0.7)]">
              {profile.avatar_url
                // eslint-disable-next-line @next/next/no-img-element -- the user's own 512 px avatar from the public avatars bucket
                ? <img src={profile.avatar_url} alt="" width={32} height={32} className="h-full w-full object-cover" />
                : initials}
            </span>
          </Link>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* Small screens: the same links as a scrollable row. */}
      <nav className={`no-scrollbar flex gap-6 overflow-x-auto border-t border-black/[0.06] px-4 py-2.5 dark:border-snow/[0.08] sm:px-5 ${wideNav ? 'xl:hidden' : 'md:hidden'}`}>{links}</nav>
      </div>
    </header>
  );
}
