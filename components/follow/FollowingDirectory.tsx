'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BadgeCheck, CalendarDays, ExternalLink, Package, Search, Users, X } from 'lucide-react';
import { countryName, flag } from '@/lib/format';
import { followerLabel } from '@/lib/follows';
import Price from '@/components/currency/Price';
import FollowButton from '@/components/follow/FollowButton';
import StarRating from '@/components/ratings/StarRating';
import RateSupplier from '@/components/ratings/RateSupplier';
import GoldBadge from '@/components/supplier/GoldBadge';

export interface FollowedSupplier {
  id: string; name: string; personName: string | null; country: string; verified: boolean; gold: boolean;
  avatarUrl: string | null; bio: string | null; since: string; followers: number | null; following: number | null;
  liveListings: number; rating: { average: number | null; count: number } | null; canRate: boolean; myStars: number | null;
  listings: { id: string; title: string; image: string | null; landedCents: number }[];
}

const initialsOf = (s: string) => s.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

function Avatar({ s, size }: { s: FollowedSupplier; size: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-14 w-14 text-base';
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#5a9895]/25 font-semibold text-[#8fd3cc] ring-1 ring-snow/10 ${cls}`}>
      {s.avatarUrl
        // eslint-disable-next-line @next/next/no-img-element -- the supplier's own avatar from the public avatars bucket
        ? <img src={s.avatarUrl} alt="" className="h-full w-full object-cover" />
        : initialsOf(s.name)}
    </span>
  );
}

/**
 * Suppliers the buyer follows: a searchable grid of profile tiles. Clicking a tile opens a profile card (modal)
 * with the supplier's bio, follower / following counts, star rating (and the buyer's own rating when allowed),
 * live listings, Follow / Unfollow and a link to the full profile.
 */
export default function FollowingDirectory({ suppliers }: { suppliers: FollowedSupplier[] }) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? suppliers.filter((s) => `${s.name} ${s.personName ?? ''} ${countryName(s.country)}`.toLowerCase().includes(q)) : suppliers;
  }, [query, suppliers]);
  const open = suppliers.find((s) => s.id === openId) ?? null;

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <label className="relative block max-w-md">
        <span className="sr-only">Search suppliers you follow</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or country" className="input pl-10" />
      </label>

      {shown.length === 0 ? (
        <p className="sx-card mt-6 px-6 py-10 text-center text-sm text-neutral-500">No supplier you follow matches “{query}”.</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpenId(s.id)} aria-haspopup="dialog"
                className="sx-card press flex w-full items-start gap-4 p-5 text-left transition-colors hover:border-snow/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]">
                <Avatar s={s} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-base font-medium text-neutral-900">{s.name}</span>
                    {s.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#8fd3cc]" aria-label="Verified" />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{flag(s.country)} {countryName(s.country)}</span>
                  {s.rating && <StarRating average={s.rating.average} count={s.rating.count} className="mt-2" />}
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                    {s.followers !== null && <span className="inline-flex items-center gap-1 tabular-nums"><Users className="h-3.5 w-3.5" aria-hidden /> {followerLabel(s.followers)}</span>}
                    <span className="inline-flex items-center gap-1 tabular-nums"><Package className="h-3.5 w-3.5" aria-hidden /> {s.liveListings} listing{s.liveListings === 1 ? '' : 's'}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Profile card */}
      <dialog ref={dialogRef} aria-labelledby="supplier-card-title" onClose={() => setOpenId(null)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpenId(null); }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl bg-transparent p-0 text-neutral-900 backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        {open && (
          <div className="sx-glass dark sellsy p-5 sm:p-7">
            <div className="flex items-start gap-4">
              <Avatar s={open} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {open.verified && <span className="sx-pill sx-pill-mint"><BadgeCheck className="h-3 w-3" aria-hidden /> Verified supplier</span>}
                  {open.gold && <GoldBadge />}
                </div>
                <h2 id="supplier-card-title" className="mt-2 truncate text-2xl font-semibold">{open.name}</h2>
                {open.personName && <p className="truncate text-sm text-neutral-600">{open.personName}</p>}
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <span>{flag(open.country)} {countryName(open.country)}</span>
                  <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> Joined {open.since}</span>
                </p>
              </div>
              <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-snow/10 hover:text-neutral-900">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <dl className="mt-6 grid grid-cols-3 gap-3">
              {([['Followers', open.followers], ['Following', open.following], ['Live listings', open.liveListings]] as const).map(([l, v]) => (
                <div key={l} className="rounded-2xl border border-snow/10 bg-snow/[0.03] p-3">
                  <dt className="text-xs text-neutral-500">{l}</dt>
                  <dd className="mt-1 text-2xl font-normal tabular-nums">{v === null ? '—' : v.toLocaleString('en-US')}</dd>
                </div>
              ))}
            </dl>

            <section aria-label="Rating" className="mt-5 rounded-2xl border border-snow/10 bg-snow/[0.03] p-4">
              {open.rating
                ? <StarRating average={open.rating.average} count={open.rating.count} size="md" />
                : <p className="text-sm text-neutral-500">Ratings aren’t available yet.</p>}
              {open.rating && (open.canRate ? (
                <div className="mt-3 border-t border-snow/[0.06] pt-3">
                  <p className="mb-1.5 text-xs text-neutral-500">{open.myStars ? 'Your rating' : 'Rate this supplier'}</p>
                  <RateSupplier key={open.id} supplierId={open.id} initial={open.myStars} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">You can rate this supplier once one of your orders from them has been released from escrow.</p>
              ))}
            </section>

            {open.bio && <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-neutral-700">{open.bio}</p>}

            <h3 className="mt-6 text-sm font-semibold">Listings</h3>
            {open.listings.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">No live listings right now.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {open.listings.map((l) => (
                  <li key={l.id}>
                    <Link href={`/dashboard/users/${open.id}`} className="group block rounded-2xl border border-snow/[0.08] bg-snow/[0.03] p-2 transition-colors hover:border-snow/25">
                      <span className="relative block aspect-square overflow-hidden rounded-xl bg-snow/[0.06]">
                        {l.image
                          ? <Image src={l.image} alt="" fill sizes="200px" className="object-cover" />
                          : <span className="grid h-full place-items-center text-neutral-500"><Package className="h-6 w-6" aria-hidden /></span>}
                      </span>
                      <span className="mt-2 block truncate text-xs font-medium text-neutral-900" title={l.title}>{l.title}</span>
                      <Price cents={l.landedCents} className="block text-xs tabular-nums text-neutral-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-snow/[0.06] pt-5">
              <FollowButton supplierId={open.id} supplierName={open.name} initialFollowing />
              <Link href={`/dashboard/users/${open.id}`} className="btn-primary px-4 py-2">View full profile <ExternalLink className="h-4 w-4" aria-hidden /></Link>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
