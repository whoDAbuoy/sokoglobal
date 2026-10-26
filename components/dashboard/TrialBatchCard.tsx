'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, BadgeCheck, Check, CheckCircle2, Eye, Film, Heart, Loader2, Lock, LogIn, ShieldCheck, ShoppingBag, Timer } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { countryName, flag } from '@/lib/format';
import { useCurrency } from '@/context/CurrencyContext';
import { useAuth } from '@/context/AuthContext';
import { CART_MAX_ITEMS, useCart } from '@/context/CartContext';
import { createClient } from '@/lib/supabase/client';
import { ROLE_LABEL, checkoutGate, gateFromStatus, importerLoginUrl, type CheckoutGate } from '@/lib/checkout-gate';
import { lineTotals } from '@/lib/cart';
import { useWishlist } from '@/hooks/useWishlist';
import QuantityStepper from '@/components/cart/QuantityStepper';
import MessageSupplierButton from '@/components/chat/MessageSupplierButton';
import ProductGallery from './ProductGallery';
import ProductQuickView from './ProductQuickView';
import InfoTip from '@/components/portal/InfoTip';
import GoldBadge from '@/components/supplier/GoldBadge';
import FollowButton from '@/components/follow/FollowButton';
import Link from 'next/link';

const IS_DEV = process.env.NODE_ENV === 'development';

export default function TrialBatchCard({ product }: { product: TrialProductView }) {
  const { formatUsd } = useCurrency();
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();
  const cart = useCart();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState(false);
  const [pickQty, setPickQty] = useState(1);   // quantity chosen before the product is in the cart
  const inCart = cart.has(product.id);
  const wishlist = useWishlist();
  const saved = wishlist.has(product.id);
  const [heartBurst, setHeartBurst] = useState(0);   // re-keys the heart so the pop animation replays
  // In the cart, the stepper edits the cart line; otherwise it sets the quantity for Add to cart / Pay now.
  const quantity = inCart ? cart.quantityOf(product.id) : pickQty;
  const setQuantity = (q: number) => (inCart ? cart.setQuantity(product.id, q) : setPickQty(q));
  const totals = lineTotals({
    goods_cents: product.goods_cents, freight_cents: product.freight_cents, customs_cents: product.customs_cents,
    landed_cost_cents: product.landed_cost_cents, trial_units: product.trial_units,
  }, quantity);
  // Only importers can buy (also enforced by the API and Postgres). A server 401/403 overrides the client view.
  const [serverGate, setServerGate] = useState<CheckoutGate | null>(null);
  const gate = serverGate ?? checkoutGate({ loading: auth.loading, signedIn: !!auth.user, role: auth.profile?.role });
  const canBuy = gate.kind !== 'signed_out' && gate.kind !== 'wrong_role';
  const [switching, setSwitching] = useState(false);

  /** Signed out → login; wrong role → sign out first, then login. Either way the buyer returns here afterwards. */
  async function signInAsImporter() {
    setSwitching(true);
    if (gate.kind === 'wrong_role') await createClient().auth.signOut();
    router.replace(importerLoginUrl(pathname));
    router.refresh();
  }

  /** Place the order (no payment channel yet): the order page's "Pay now" offers every method that is switched on. */
  async function placeOrder() {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id, quantity }),
      });
      const blocked = gateFromStatus(res.status, auth.profile?.role);
      if (blocked) { setServerGate(blocked); setState('idle'); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not place the order');
      setState('done');
      router.push(`/dashboard/orders/${json.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place the order');
      setState('error');
    }
  }

  const lines = [
    { label: `Product · ${totals.units} units`, value: totals.goods_cents, bar: 'bg-blue-500', dot: 'bg-blue-500',
      tip: 'The supplier’s price for the goods. It is paid to them only after you verify delivery.' },
    { label: 'Consolidated air freight', value: totals.freight_cents, bar: 'bg-cyan-500', dot: 'bg-cyan-500',
      tip: 'Your share of a consolidated air shipment from the supplier’s country to your door.' },
    { label: 'Customs clearance & duties', value: totals.customs_cents, bar: 'bg-indigo-500', dot: 'bg-indigo-500',
      tip: 'Import duties, taxes and clearance fees, quoted up front so there are no surprise charges on arrival.' },
  ];
  const lineTotal = Math.max(1, lines.reduce((sum, l) => sum + l.value, 0));
  const perUnit = Math.round(totals.landed_cost_cents / Math.max(1, totals.units));
  const images = product.image_urls?.length ? product.image_urls : product.image_url ? [product.image_url] : [];

  /** Keep browsing: the cart is paid once, from the cart drawer → checkout. */
  function addToCart() {
    const result = cart.add({
      productId: product.id, title: product.title, supplierName: product.supplier_name,
      imageUrl: images[0] ?? null, category: product.category, landedCostCents: product.landed_cost_cents,
    }, pickQty);
    if (result === 'full') { setError(`Your cart holds up to ${CART_MAX_ITEMS} Trial Batches — check out or remove one first.`); return; }
    toast.success('Added to cart', { description: `${pickQty} × ${product.title}`, action: { label: 'View cart', onClick: () => cart.setOpen(true) } });
  }

  const cartButton = inCart ? (
    <button type="button" onClick={() => cart.setOpen(true)} className="btn-secondary w-full">
      <Check className="h-4 w-4 text-emerald-600" /> In cart
    </button>
  ) : (
    <button type="button" onClick={addToCart} disabled={state === 'loading' || product.is_demo} className="btn-secondary w-full"
      title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
      <ShoppingBag className="h-4 w-4" /> Add to cart
    </button>
  );

  // Payment block — rendered in the card and in the Quick View, so both use the same checkout handlers and state.
  const actions = (
    <>
      {gate.kind === 'signed_out' || gate.kind === 'wrong_role' ? (
        <div role="status" className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <p className="font-medium text-neutral-900">
            {gate.kind === 'signed_out' ? 'Sign in to buy' : 'Purchases need an Importer account'}
          </p>
          <p className="mt-1 text-neutral-600">
            {gate.kind === 'signed_out'
              ? 'Sign in with your importer account to place an order.'
              : `You're signed in as ${ROLE_LABEL[gate.role]}. Trial Batches can only be bought from an importer account.`}
          </p>
          {IS_DEV && (
            <p className="mt-2 text-xs text-neutral-500">
              Local testing: run <code className="font-mono">npm run dev:importer</code> to create a test importer login.
            </p>
          )}
          <button type="button" onClick={() => void signInAsImporter()} disabled={switching} className="btn-primary mt-3 w-full">
            {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {gate.kind === 'signed_out' ? 'Sign in to buy' : 'Sign in as an importer'}
          </button>
        </div>
      ) : state === 'done' ? (
        <p className="flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Order placed · opening payment…
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 pb-1">
            <QuantityStepper value={quantity} onChange={setQuantity} label="Trial Batches" size="sm" disabled={state === 'loading' || product.is_demo} />
            <p className="text-right text-xs leading-tight text-neutral-500">
              {quantity} × {formatUsd(product.landed_cost_cents)}
              <span className="block text-sm font-semibold tabular-nums text-neutral-900">{formatUsd(totals.landed_cost_cents)}</span>
            </p>
          </div>
          {/* One primary action: the payment channel is chosen afterwards, under "Pay now" on the order page. */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void placeOrder()} disabled={state === 'loading' || product.is_demo}
              className="btn-primary w-full px-2 active:scale-95" title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
              {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Place order
            </button>
            {cartButton}
          </div>
          <MessageSupplierButton productId={product.id} productTitle={product.title} disabled={product.is_demo} variant="link" className="w-full justify-center pt-1" />
        </div>
      )}
      {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
    </>
  );

  return (
    <article className="glass-card group flex flex-col p-3 transition duration-300 ease-out hover:border-snow/15">
      {/* Clicking the photos opens the Quick View; swiping scrolls the gallery (touch swipes don't produce clicks). */}
      <div className="relative cursor-pointer overflow-hidden rounded-2xl transition duration-300 ease-out group-hover:-translate-y-0.5" onClick={() => setQuickView(true)}>
        <ProductGallery images={images} media={product.media} alt={product.title} category={product.category} className="aspect-square" arrows="hover"
          dotsClassName="group-hover:-translate-y-12 group-focus-within:-translate-y-12 [@media(hover:none)]:-translate-y-12" />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="pill border-transparent bg-[#5a9895] text-snow shadow">Trial Batch</span>
          {product.is_featured && <span className="pill border-transparent bg-violet-600 text-snow shadow">Featured</span>}
          {product.is_demo && <span className="pill border-amber-200 bg-amber-50 text-amber-800">Sample</span>}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5">
          {product.has_swatch_video && (
            <span className="pill border-transparent bg-neutral-900/80 text-white"><Film className="h-3.5 w-3.5" /> Swatch video</span>
          )}
          {saved && (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/95 shadow-card" aria-hidden>
              <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500" />
            </span>
          )}
        </div>

        {/* Hover action bar: slides up from the bottom of the image (always visible on touch screens). */}
        <div role="toolbar" aria-label={`Actions for ${product.title}`} onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-3 bottom-3 frost-pop flex items-center gap-1 rounded-lg p-1
            translate-y-[calc(100%+1rem)] opacity-0 transition duration-300 ease-out
            group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100
            [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
          <button type="button" onClick={() => setQuickView(true)} aria-label={`Quick view: ${product.title}`} title="Quick view"
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-neutral-900 transition hover:bg-neutral-100">
            <Eye className="h-4 w-4" /> <span className="hidden sm:inline">Quick view</span>
          </button>
          {canBuy && (
            inCart ? (
              <button type="button" onClick={() => cart.setOpen(true)} aria-label="In cart — view cart" title="In cart — view cart"
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-xs font-medium text-white transition hover:bg-neutral-700">
                <Check className="h-4 w-4" /> <span className="hidden sm:inline">In cart</span>
              </button>
            ) : (
              <button type="button" onClick={addToCart} disabled={state === 'loading' || product.is_demo}
                aria-label={`Add ${quantity} to cart`} title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : `Add ${quantity} to cart`}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-neutral-900 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50">
                <ShoppingBag className="h-4 w-4" /> <span className="hidden sm:inline">Add{quantity > 1 ? ` ${quantity}` : ''}</span>
              </button>
            )
          )}
          <button type="button" aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'} title={saved ? 'Saved' : 'Save'}
            onClick={() => {
              const now = wishlist.toggle(product.id);
              if (now) setHeartBurst((n) => n + 1);
              toast(now ? 'Saved to your wishlist' : 'Removed from your wishlist', { description: product.title });
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md transition hover:bg-neutral-100">
            <Heart key={heartBurst} className={clsx('h-4 w-4 transition-colors', saved ? 'fill-red-500 text-red-500 motion-safe:animate-heart-pop' : 'text-neutral-700')} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-1 pb-1 pt-4">
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-neutral-500">
            {flag(product.origin_country)}{' '}
            {product.supplier_id && !product.is_demo
              ? <Link href={`/dashboard/users/${product.supplier_id}`} className="truncate hover:text-neutral-900 hover:underline">{product.supplier_name}</Link>
              : <span className="truncate">{product.supplier_name}</span>}
            {product.supplier_verified && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>
            )}
            {product.supplier_gold && <GoldBadge compact />}
          </p>
          {product.supplier_id && <FollowButton supplierId={product.supplier_id} supplierName={product.supplier_name} isDemo={product.is_demo} size="sm" />}
        </div>
        <h3 className="mt-1 text-base font-medium leading-snug text-neutral-900">
          <button type="button" onClick={() => setQuickView(true)} className="text-left underline-offset-4 hover:underline focus:outline-none focus-visible:underline">
            {product.title}
          </button>
        </h3>
        {(product.category_name || product.moq || product.price_tiers?.length) && (
          <p className="mt-1 text-xs text-neutral-600">
            {[product.category_name, product.moq ? `MOQ ${product.moq.toLocaleString('en-US')} ${product.unit_of_measure ?? ''}`.trim() : null,
              product.price_tiers?.length ? `Volume pricing from ${formatUsd(Math.min(...product.price_tiers.map((t) => t.unit_price_cents)))}/${product.unit_of_measure ?? 'unit'}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        )}
        <p className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className="text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{formatUsd(totals.landed_cost_cents)}</span>
          <span className="text-xs tabular-nums text-neutral-500">
            {formatUsd(Math.round(product.landed_cost_cents / Math.max(1, product.trial_units)))} / unit landed
          </span>
        </p>

        {/* Guaranteed Landed Cost breakdown — the core trust element. Updates live with the quantity stepper. */}
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-neutral-100" role="img"
            aria-label={`Landed cost split: ${lines.map((l) => `${l.label} ${Math.round((l.value / lineTotal) * 100)}%`).join(', ')}`}>
            {lines.map((l) => (
              <span key={l.label} className={clsx('h-full transition-[width] duration-500 ease-out first:rounded-l-full last:rounded-r-full', l.bar)}
                style={{ width: `${(l.value / lineTotal) * 100}%` }} />
            ))}
          </div>
          <dl className="space-y-1 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex items-center justify-between gap-2 text-neutral-500">
                <dt className="flex items-center gap-1.5">
                  <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', l.dot)} aria-hidden />
                  {l.label}
                  <InfoTip text={l.tip} label={`About ${l.label}`} />
                </dt>
                <dd className="tabular-nums transition-colors">{formatUsd(l.value)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1 text-xs text-neutral-500">
              <dt className="flex items-center gap-1.5">Per unit, landed <InfoTip text="Guaranteed Landed Cost divided by the units in your batches — what each piece costs you at your door." label="About per-unit landed price" /></dt>
              <dd className="font-semibold tabular-nums text-blue-600 dark:text-blue-400">{formatUsd(perUnit)} × {totals.units}</dd>
            </div>
          </dl>
          <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-neutral-200 pt-2.5">
            <div>
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-neutral-900">
                <Lock className="h-3 w-3" /> Guaranteed Landed Cost
              </p>
              <p className="text-xs text-neutral-500">Delivered to your door · no surprise fees</p>
            </div>
            <p className="text-right text-lg font-semibold tabular-nums text-neutral-900">
              {formatUsd(totals.landed_cost_cents)}
              {quantity > 1 && <span className="block text-xs font-normal text-neutral-500">{quantity} batches</span>}
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Timer className="h-3.5 w-3.5" />
          {product.lead_time_days ? `${product.lead_time_days}–${product.lead_time_days + 4} days` : 'Lead time on request'} from {countryName(product.origin_country)}
        </p>

        <div className="mt-auto pt-5">{actions}</div>
      </div>

      {quickView && <ProductQuickView product={product} quantity={quantity} onClose={() => setQuickView(false)} actions={actions} />}
    </article>
  );
}
