'use client';

import Link from 'next/link';
import { BadgeCheck, Bell, LogOut, ShieldCheck, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import type { Profile } from '@/lib/types';

const NAV: Record<Profile['role'], [string, string][]> = {
  importer: [['Discover', '/dashboard'], ['Trend Pools', '/dashboard#pools'], ['Orders', '/dashboard#orders']],
  supplier: [['Catalogue', '/supplier'], ['New product', '/supplier/products/new'], ['Verification', '/supplier/verification']],
  admin: [['Review queue', '/admin'], ['Catalogue', '/admin/products'], ['Shipments', '/admin/orders'], ['Supplier KYC', '/admin/kyc'], ['Support', '/admin/support']],
};

export default function DashboardHeader({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const cart = useCart();
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const links = NAV[profile.role].map(([label, href]) => (
    <Link key={label} href={href}
      className="whitespace-nowrap text-sm text-neutral-600 transition-colors hover:text-neutral-900">{label}</Link>
  ));

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-neutral-900" strokeWidth={2.25} />
            <span className="text-base font-semibold tracking-tight text-neutral-900">SokoGlobal</span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">{links}</nav>
        </div>

        <div className="flex items-center gap-1">
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
          <button type="button" aria-label="Notifications" className="rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
            <Bell className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <div className="ml-2 flex items-center gap-3 border-l border-neutral-200 py-1 pl-4 pr-1">
            <div className="hidden text-right sm:block">
              <p className="flex items-center justify-end gap-1 text-sm font-medium text-neutral-900">
                {profile.company_name}
                {profile.kyc_verified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verified business" />}
              </p>
              <p className="text-xs text-neutral-500">{profile.full_name}</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-900 text-xs font-medium text-white">{initials}</span>
          </div>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded-md p-2 text-neutral-600 transition-colors hover:text-neutral-900">
            <LogOut className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* Small screens: the same links as a scrollable row. */}
      <nav className="flex gap-6 overflow-x-auto border-t border-neutral-100 px-4 py-2.5 sm:px-6 md:hidden">{links}</nav>
    </header>
  );
}
