'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { BadgeCheck, Check, Heart, Loader2, ShoppingBag, Trash2 } from 'lucide-react';
import type { ProductCategory } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { flag } from '@/lib/format';
import { useCurrency } from '@/context/CurrencyContext';
import { UUID_RE } from '@/lib/uploads';
import { DEMO_PRODUCTS } from '@/lib/demo-data';
import { useAuth } from '@/context/AuthContext';
import { CART_MAX_ITEMS, useCart } from '@/context/CartContext';
import { useWishlist } from '@/hooks/useWishlist';
import { ROLE_LABEL, checkoutGate } from '@/lib/checkout-gate';
import ProductVisual from '@/components/dashboard/ProductVisual';

interface SavedProduct {
  id: string;
  title: string;
  category: ProductCategory;
  origin_country: string;
  supplier_name: string;
  supplier_verified: boolean;
  trial_units: number;
  landed_cost_cents: number;
  image_url: string | null;
  available: boolean;
  is_demo?: boolean;
}

type Row = {
  id: string; title: string; category: ProductCategory; origin_country: string; status: string;
  trial_units: number; trial_landed_cost_cents: number;
  supplier: { company_name: string; kyc_verified: boolean } | { company_name: string; kyc_verified: boolean }[] | null;
  product_media: { public_url: string; media_type: string; sort_order: number }[] | null;
};

/**
 * Wishlist page body. Ids come from the browser (useWishlist); details are read
 * live (RLS: buyers see live products), so prices are always current and
 * removed products show as unavailable. Cart and checkout are unchanged —
 * Add to cart uses the same cart.add() as the product cards.
 */
export default function WishlistView() {
  const { formatUsd } = useCurrency();
  const wishlist = useWishlist();
  const cart = useCart();
  const auth = useAuth();
  const gate = checkoutGate({ loading: auth.loading, signedIn: !!auth.user, role: auth.profile?.role });
  const [products, setProducts] = useState<Map<string, SavedProduct>>(new Map());
  const [loading, setLoading] = useState(true);
  const key = wishlist.ids.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = key ? key.split(',') : [];
      const map = new Map<string, SavedProduct>();
      for (const d of DEMO_PRODUCTS) {
        if (ids.includes(d.id)) {
          map.set(d.id, { id: d.id, title: d.title, category: d.category, origin_country: d.origin_country, supplier_name: d.supplier_name,
            supplier_verified: d.supplier_verified, trial_units: d.trial_units, landed_cost_cents: d.landed_cost_cents, image_url: d.image_url, available: true, is_demo: true });
        }
      }
      const real = ids.filter((id) => UUID_RE.test(id));
      if (real.length) {
        const { data } = await createClient().from('products')
          .select(`id, title, category, origin_country, status, trial_units, trial_landed_cost_cents,
                   supplier:profiles!products_supplier_id_fkey ( company_name, kyc_verified ),
                   product_media ( public_url, media_type, sort_order )`)
          .in('id', real);
        for (const p of (data ?? []) as Row[]) {
          const supplier = Array.isArray(p.supplier) ? p.supplier[0] : p.supplier;
          const image = [...(p.product_media ?? [])].filter((m) => m.media_type === 'image').sort((a, b) => a.sort_order - b.sort_order)[0]?.public_url ?? null;
          map.set(p.id, { id: p.id, title: p.title, category: p.category, origin_country: p.origin_country,
            supplier_name: supplier?.company_name ?? 'Verified supplier', supplier_verified: !!supplier?.kyc_verified,
            trial_units: p.trial_units, landed_cost_cents: p.trial_landed_cost_cents, image_url: image, available: p.status === 'live' });
        }
      }
      if (!cancelled) { setProducts(map); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [key]);

  function remove(p: { id: string; title: string }) {
    wishlist.toggle(p.id);
    toast('Removed from your wishlist', { description: p.title, action: { label: 'Undo', onClick: () => wishlist.toggle(p.id) } });
  }

  function addToCart(p: SavedProduct) {
    const result = cart.add({ productId: p.id, title: p.title, supplierName: p.supplier_name, imageUrl: p.image_url,
      category: p.category, landedCostCents: p.landed_cost_cents }, 1);
    if (result === 'full') { toast.error(`Your cart holds up to ${CART_MAX_ITEMS} products — check out or remove one first.`); return; }
    toast.success('Added to cart', { description: p.title, action: { label: 'View cart', onClick: () => cart.setOpen(true) } });
  }

  // Newest saved first.
  const ordered = [...wishlist.ids].reverse();

  if (!loading && ordered.length === 0) {
    return (
      <div className="card mt-8 flex flex-col items-center px-6 py-16 text-center">
        <Heart className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
        <p className="mt-3 font-medium text-neutral-900">No saved products yet</p>
        <p className="mt-1 text-sm text-neutral-500">Tap the heart on any Trial Batch to keep it here.</p>
        <Link href="/dashboard#batches" className="btn-primary mt-6">Browse Trial Batches</Link>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <p className="text-sm text-neutral-500">{ordered.length} saved product{ordered.length === 1 ? '' : 's'}</p>
      {(gate.kind === 'wrong_role') && (
        <p className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
          You&apos;re signed in as {ROLE_LABEL[gate.role]} — sign in with an importer account to buy.
        </p>
      )}
      <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {ordered.map((id) => {
          const p = products.get(id);
          if (!p) {
            return (
              <li key={id} className="flex items-center gap-4 py-4">
                <div className="h-24 w-24 shrink-0 rounded-md bg-neutral-100" />
                <div className="flex-1 text-sm text-neutral-500">
                  {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span> : 'This product is no longer available.'}
                </div>
                {!loading && <RemoveButton onClick={() => remove({ id, title: 'Unavailable product' })} />}
              </li>
            );
          }
          const inCart = cart.has(p.id);
          return (
            <li key={id} className="flex flex-wrap items-center gap-4 py-4 sm:flex-nowrap">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md">
                <ProductVisual src={p.image_url} alt={p.title} category={p.category} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                  {flag(p.origin_country)} {p.supplier_name}
                  {p.supplier_verified && <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Verified" />}
                </p>
                <p className="mt-0.5 font-medium text-neutral-900">{p.title}</p>
                {p.available ? (
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className="font-semibold tabular-nums text-neutral-900">{formatUsd(p.landed_cost_cents)}</span>
                    <span className="text-xs tabular-nums text-neutral-500">{formatUsd(Math.round(p.landed_cost_cents / Math.max(1, p.trial_units)))} / unit landed</span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-amber-700">No longer available</p>
                )}
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {p.available && gate.kind !== 'wrong_role' && gate.kind !== 'signed_out' && (
                  inCart ? (
                    <button type="button" onClick={() => cart.setOpen(true)} className="btn-secondary flex-1 sm:flex-none">
                      <Check className="h-4 w-4 text-emerald-600" /> In cart
                    </button>
                  ) : (
                    <button type="button" onClick={() => addToCart(p)} disabled={p.is_demo} className="btn-primary flex-1 sm:flex-none"
                      title={p.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
                      <ShoppingBag className="h-4 w-4" /> Add to cart
                    </button>
                  )
                )}
                <RemoveButton onClick={() => remove(p)} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove from wishlist"
      className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm text-neutral-600 transition hover:bg-red-50 hover:text-red-700">
      <Trash2 className="h-4 w-4" /> <span>Remove</span>
    </button>
  );
}
