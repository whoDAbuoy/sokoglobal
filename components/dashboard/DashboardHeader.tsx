'use client';

import Link from 'next/link';
import {
  BadgeCheck, Bell, ClipboardCheck, Compass, FileCheck2, Headphones, Heart, LayoutDashboard, LogOut, MessageSquare, Package,
  PackagePlus, ShieldCheck, ShieldHalf, ShoppingBag, Store, Truck, Undo2, UserCog, Users, Gauge, LayoutGrid, FileQuestion, Landmark, FilePen, BarChart3, Boxes, Receipt, RotateCcw, type LucideIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useChat } from '@/context/ChatContext';
import { useWishlist } from '@/hooks/useWishlist';
import type { Profile } from '@/lib/types';
import { ADMIN_LEVEL_LABEL, adminLevel, formatTimeLeft, homePathFor, roleAdminLevel } from '@/lib/auth/admin-access';
import CurrencySwitcher from '@/components/currency/CurrencySwitcher';
import MobileNav from '@/components/navigation/MobileNav';

const ADMIN_NAV: [string, string][] = [['Overview', '/admin'], ['Review queue', '/admin/review'], ['Catalogue', '/admin/products'], ['Shipments', '/admin/orders'], ['Supplier KYC', '/admin/kyc'], ['Users', '/admin/users'], ['Support', '/admin/support']];
const NAV: Record<Profile['role'], [string, string][]> = {
  importer: [['Discover', '/dashboard'], ['Catalog', '/dashboard/discover'], ['RFQs', '/dashboard/rfqs'], ['Trend Pools', '/dashboard#pools'], ['Messages', '/dashboard/messages']],
  // Sellsy-style supplier tabs: the seven pill sections first, then the portal's working pages.
  supplier: [['Overview', '/supplier'], ['Sales', '/supplier#sales'], ['Analytics', '/supplier#analytics'], ['Products', '/supplier/products'],
    ['Inventory', '/supplier/inventory'], ['Orders', '/supplier/orders'], ['Returns', '/supplier/returns'], ['Drafts', '/supplier/drafts'],
    ['RFQs', '/supplier/rfqs'], ['Messages', '/supplier/messages'], ['Verification', '/supplier/verification']],
  admin: ADMIN_NAV,
  // Super admins also run the chat center (every conversation + direct support, migration 025) and pricing (026).
  super_admin: [...ADMIN_NAV, ['Messages', '/admin/messages'], ['Financials', '/admin/financials']],
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
  'My portal': Undo2, Orders: Truck, RFQs: FileQuestion, Financials: Landmark, Drafts: FilePen,
  Sales: Receipt, Analytics: BarChart3, Products: Store, Inventory: Boxes, Returns: RotateCcw,
};

/** The link for the current page: the longest href the path sits under (so /supplier/drafts marks Drafts, not Catalogue). */
function activeHref(hrefs: string[], pathname: string): string | null {
  const hits = hrefs.filter((h) => !h.includes('#') && (pathname === h || pathname.startsWith(`${h}/`)));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export default function DashboardHeader({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const cart = useCart();
  const { unreadCount, adminUnreadCount } = useChat();
  const saved = useWishlist().ids.length;
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const pathname = usePathname() ?? '';
  const level = adminLevel(profile);
  const items = navLinks(profile, pathname);
  const current = activeHref(items.map(([, href]) => href), pathname);
  // Inside the supplier portal (always dark) the sections are Sellsy pill tabs: white active pill, no icons.
  const pills = pathname === '/supplier' || pathname.startsWith('/supplier/');
  const links = items.map(([label, href]) => {
    const Icon = pills ? undefined : NAV_ICON[label];
    const active = href === current;
    return (
    <Link key={label} href={href} aria-current={active ? 'page' : undefined}
      className={pills ? 'sx-tab press' : `group/nav press inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active
        ? 'bg-neutral-900/[0.06] font-medium text-neutral-900 dark:bg-snow/10'
        : 'text-neutral-600 hover:bg-neutral-900/[0.04] hover:text-neutral-900 dark:hover:bg-snow/[0.06]'}`}>
      {Icon && <Icon className={`h-4 w-4 transition-colors group-hover/nav:text-blue-500 ${active ? 'text-blue-600 dark:text-cyan-400' : 'text-neutral-400'}`} strokeWidth={1.75} aria-hidden />}
      {label}
      {label === 'Messages' && unreadCount > 0 && (
        <span aria-label={`${unreadCount} unread`} className="grid h-4 min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold tabular-nums text-snow">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {label === 'Messages' && adminUnreadCount > 0 && (
        <span title={`${adminUnreadCount} unread message${adminUnreadCount === 1 ? '' : 's'} from SokoGlobal`}
          className="inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold uppercase tone-active">
          <ShieldCheck className="h-3 w-3" aria-hidden /> Admin
          <span className="sr-only">: {adminUnreadCount} unread from SokoGlobal</span>
        </span>
      )}
    </Link>
    );
  });

  const iconBtn = 'press relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-600 hover:bg-neutral-900/[0.05] hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-snow/[0.08]';
  const badge = 'absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums text-snow';

  return (
    <>
    <header className="glass-nav">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:h-16 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center">
          <Link href="/" aria-label="SokoGlobal home" className="press flex shrink-0 items-center gap-2 rounded-full">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-cyan-400" strokeWidth={2.25} aria-hidden />
            <span className="hidden text-base font-semibold tracking-tight text-neutral-900 sm:inline">SokoGlobal</span>
          </Link>
        </div>

        {/* Each control is a fixed-size chip and the gap alone spaces them, so neighbours never touch or overlap.
            Phones get a tighter gap (and a logo mark without the wordmark) so the importer's six controls fit at 360 px. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3 md:gap-4">
          {roleAdminLevel(profile.role) && (
            <Link href="/admin/control" aria-label="Control room: platform switches, overrides and audit log" title="Control room"
              aria-current={pathname.startsWith('/admin/control') ? 'page' : undefined}
              className={`nav-chip px-2.5 sm:px-3 ${pathname.startsWith('/admin/control') ? 'border-neutral-900 text-neutral-900 dark:border-snow/40' : ''}`}>
              <Gauge className="h-4 w-4" strokeWidth={1.75} aria-hidden /> <span className="hidden sm:inline">Control</span>
            </Link>
          )}
          <CurrencySwitcher />
          {profile.role === 'importer' && (
            <Link href="/dashboard/orders" aria-label="My orders and escrow tracking" className="nav-chip px-2.5 sm:px-3">
              <Package className="h-4 w-4" strokeWidth={1.75} /> <span className="hidden sm:inline">My Orders</span>
            </Link>
          )}
          {profile.role === 'importer' && (
            <Link href="/dashboard/wishlist" aria-label={`Wishlist, ${saved} saved`} className={iconBtn}>
              <Heart className="h-5 w-5" strokeWidth={1.75} />
              {saved > 0 && <span className={`${badge} bg-red-500`}>{saved > 99 ? '99+' : saved}</span>}
            </Link>
          )}
          {profile.role === 'importer' && (
            <button type="button" onClick={() => cart.setOpen(true)} aria-label={`Cart, ${cart.items.length} item${cart.items.length === 1 ? '' : 's'}`} className={iconBtn}>
              <ShoppingBag className="h-5 w-5" strokeWidth={1.75} />
              {cart.items.length > 0 && <span className={`${badge} bg-blue-600`}>{cart.items.length}</span>}
            </button>
          )}
          <button type="button" aria-label="Notifications" className={`${iconBtn} hidden sm:grid`}>
            <Bell className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-black/[0.08] dark:bg-snow/10 sm:block" />
          <Link href="/dashboard/settings" aria-label="Profile & settings" title="Profile & settings"
            className="press flex shrink-0 items-center gap-3 rounded-full p-1 hover:bg-neutral-900/[0.04] sm:pl-3 dark:hover:bg-snow/[0.06]">
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
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className={iconBtn}>
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* App-style layout at every width: the section links always get their own scrollable pill row, so the
          account controls above never share space with them (no overlap, whatever the role or link count). */}
      <div className="border-t border-black/[0.06] dark:border-snow/[0.08]">
        <nav aria-label="Sections" className={pills
          // Supplier pills sit centred (w-max + mx-auto) and still scroll sideways when they don't fit.
          ? 'no-scrollbar mx-auto max-w-7xl overflow-x-auto px-2.5 py-2.5 sm:px-4 lg:px-6'
          : 'no-scrollbar mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2.5 py-1.5 sm:px-4 lg:px-6'}>
          {pills ? <div className="mx-auto flex w-max gap-1.5">{links}</div> : links}
        </nav>
      </div>
    </header>
    {/* Outside <header>: its backdrop-filter would make it the containing block for the fixed dock. */}
    <MobileNav profile={profile} />
    </>
  );
}
