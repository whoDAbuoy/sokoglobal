'use client';

import Link from 'next/link';
import { BadgeCheck, Bell, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { Profile } from '@/lib/types';

const NAV: Record<Profile['role'], [string, string][]> = {
  importer: [['Discover', '/dashboard'], ['Trend Pools', '/dashboard#pools'], ['Orders', '/dashboard#orders']],
  supplier: [['Catalogue', '/supplier'], ['New product', '/supplier/products/new'], ['Verification', '/supplier/verification']],
  admin: [['Products', '/admin'], ['Shipments', '/admin/orders'], ['Supplier KYC', '/admin/kyc'], ['Support', '/admin/support']],
};

export default function DashboardHeader({ profile }: { profile: Profile }) {
  const { signOut } = useAuth();
  const initials = profile.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-900">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
            </span>
            <span className="font-semibold tracking-tight text-slate-900">SokoGlobal</span>
          </Link>
          <nav className="hidden gap-1 text-sm font-medium md:flex">
            {NAV[profile.role].map(([label, href]) => (
              <Link key={label} href={href} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">{label}</Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" aria-label="Notifications" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <Bell className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3 rounded-lg py-1 pl-2 pr-1">
            <div className="hidden text-right sm:block">
              <p className="flex items-center justify-end gap-1 text-sm font-medium text-slate-900">
                {profile.company_name}
                {profile.kyc_verified && <BadgeCheck className="h-4 w-4 text-brand-600" aria-label="Verified business" />}
              </p>
              <p className="text-xs text-slate-500">{profile.full_name}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{initials}</span>
          </div>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
