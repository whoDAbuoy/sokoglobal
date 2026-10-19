'use client';

import Link from 'next/link';
import { BadgeCheck, Bell, Heart, LogOut, Package, ShieldCheck, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { useChat } from '@/context/ChatContext';
import { useWishlist } from '@/hooks/useWishlist';
import type { Profile } from '@/lib/types';

const NAV: Record<Profile['role'], [string, string][]> = {
  importer: [['Discover', '/dashboard'], ['Trend Pools', '/dashboard#pools'], ['Messages', '/dashboard/messages']],
  supplier: [['Catalogue', '/supplier'], ['Messages', '/supplier/messages'], ['New product', '/supplier/products/new'], ['Verification', '/supplier/verification']],
  admin: [['Overview', '/admin'], ['Review queue', '/admin/review'], ['Catalogue', '/admin/products'], ['Shipments', '/admin/orders'], ['Supplier KYC', '/admin/kyc'], ['Support', '/admin/support']],
};

export default function DashboardHeader({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const cart = useCart();
  const { unreadCount } = useChat();
  const saved = useWishlist().ids.length;
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const links = NAV[profile.role].map(([label, href]) => (
    <Link key={label} href={href}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-neutral-600 transition-colors hover:text-neutral-900">
      {label}
      {label === 'Messages' && unreadCount > 0 && (
        <span aria-label={`${unreadCount} unread`} className="grid h-4 min-w-4 place-items-center rounded-full bg-neutral-900 px-1 text-[10px] font-semibold tabular-nums text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  ));

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-neutral-900" strokeWidth={2.25} />
            <span className="text-base font-semibold tracking-tight text-neutral-900">SokoGlobal</span>
          </Link>
          <nav className={profile.role === 'admin' ? 'hidden items-center gap-6 lg:flex' : 'hidden items-center gap-7 md:flex'}>{links}</nav>
        </div>

        <div className="flex items-center gap-1">
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
          <Link href="/dashboard/profile" aria-label="Profile & settings" title="Profile & settings"
            className="ml-1 flex items-center gap-3 rounded-md border-l border-neutral-200 py-1 pl-2 pr-1 transition-colors hover:bg-neutral-50 sm:ml-2 sm:pl-4">
            <div className="hidden text-right sm:block">
              <p className="flex items-center justify-end gap-1 text-sm font-medium text-neutral-900">
                {profile.company_name}
                {profile.kyc_verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verified business" />}
              </p>
              <p className="text-xs text-neutral-500">{profile.full_name}</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-900 text-xs font-medium text-white">{initials}</span>
          </Link>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* Small screens: the same links as a scrollable row. */}
      <nav className={`flex gap-6 overflow-x-auto border-t border-neutral-100 px-4 py-2.5 sm:px-6 ${profile.role === 'admin' ? 'lg:hidden' : 'md:hidden'}`}>{links}</nav>
    </header>
  );
}
