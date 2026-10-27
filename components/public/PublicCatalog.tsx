import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, ImageOff, ShieldCheck } from 'lucide-react';
import { flag, formatUSD } from '@/lib/format';
import { productPath, supplierPath } from '@/lib/seo';
import type { PublicListingCard } from '@/lib/public-catalog';

/**
 * Server-rendered building blocks of the public listing / supplier pages (no client JS beyond the
 * header's links). Anyone can view these pages; buying, quoting and messaging go through sign-in.
 */

export function PublicHeader() {
  return (
    <header className="glass-nav sticky top-0 z-40">
      <div className="mx-auto flex h-14 w-full max-w-[1920px] items-center justify-between gap-3 px-3 sm:h-16 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
          <ShieldCheck className="h-5 w-5 text-[#8fd3cc]" strokeWidth={2.25} aria-hidden />
          <span className="text-base font-semibold tracking-tight text-neutral-900">SokoGlobal</span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
          <Link href="/products" className="press hidden rounded-full px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900 sm:inline">Browse Trial Batches</Link>
          <Link href="/login" className="press rounded-full px-3 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900">Sign in</Link>
          <Link href="/signup" className="btn-primary px-4 py-2">Get started</Link>
        </nav>
      </div>
    </header>
  );
}

export function ListingCard({ listing, showSupplier = true }: { listing: PublicListingCard; showSupplier?: boolean }) {
  return (
    <li className="glass-card overflow-hidden">
      <Link href={productPath(listing.id, listing.title)} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
        <div className="relative aspect-[4/3] bg-neutral-900/[0.04] dark:bg-snow/[0.04]">
          {listing.image_url
            ? <Image src={listing.image_url} alt={listing.title} fill sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            : <ImageOff className="absolute inset-0 m-auto h-6 w-6 text-neutral-400" aria-hidden />}
        </div>
        <div className="p-4">
          <h3 className="line-clamp-2 font-medium text-neutral-900 group-hover:underline">{listing.title}</h3>
          <p className="mt-1 text-xs text-neutral-500">
            {flag(listing.origin_country)} {listing.trial_units.toLocaleString('en-US')} units · landed
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-neutral-900">{formatUSD(listing.landed_cost_cents)}</p>
          {showSupplier && (
            <p className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
              {listing.supplier_company}
              {listing.supplier_verified && <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" aria-label="KYC verified" />}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export function ListingGrid({ listings, showSupplier = true, label }: { listings: PublicListingCard[]; showSupplier?: boolean; label: string }) {
  return (
    <ul aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listings.map((l) => <ListingCard key={l.id} listing={l} showSupplier={showSupplier} />)}
    </ul>
  );
}

/** Placeholder while a listing grid streams in (same card shape, so nothing jumps). */
export function ListingGridSkeleton({ count = 4, label = 'Loading listings' }: { count?: number; label?: string }) {
  const block = 'bg-neutral-900/[0.06] dark:bg-snow/[0.06] motion-safe:animate-pulse';
  return (
    <div role="status">
      <span className="sr-only">{label}…</span>
      <ul aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="glass-card overflow-hidden">
            <div className={`aspect-[4/3] ${block}`} />
            <div className="space-y-2 p-4">
              <div className={`h-4 w-3/4 rounded ${block}`} />
              <div className={`h-3 w-1/2 rounded ${block}`} />
              <div className={`h-5 w-1/3 rounded ${block}`} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SupplierLink({ id, name }: { id: string; name: string }) {
  return <Link href={supplierPath(id, name)} className="font-medium text-neutral-900 underline-offset-2 hover:underline">{name}</Link>;
}
