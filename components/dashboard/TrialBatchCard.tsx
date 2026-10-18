'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, BadgeCheck, Check, CheckCircle2, Eye, Film, Loader2, Lock, LogIn, ShieldCheck, ShoppingBag, Smartphone, Timer } from 'lucide-react';
import type { TrialProductView } from '@/lib/types';
import { countryName, flag, formatUSD } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { CART_MAX_ITEMS, useCart } from '@/context/CartContext';
import { createClient } from '@/lib/supabase/client';
import { ROLE_LABEL, checkoutGate, gateFromStatus, importerLoginUrl, type CheckoutGate } from '@/lib/checkout-gate';
import ProductGallery from './ProductGallery';
import ProductQuickView from './ProductQuickView';

const MPESA_ENABLED = process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true';
const IS_DEV = process.env.NODE_ENV === 'development';

export default function TrialBatchCard({ product }: { product: TrialProductView }) {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();
  const cart = useCart();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [method, setMethod] = useState<'card' | 'mpesa'>('card');
  const [error, setError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState(false);
  // Only importers can buy (also enforced by the API and Postgres). A server 401/403 overrides the client view.
  const [serverGate, setServerGate] = useState<CheckoutGate | null>(null);
  const gate = serverGate ?? checkoutGate({ loading: auth.loading, signedIn: !!auth.user, role: auth.profile?.role });
  const [switching, setSwitching] = useState(false);

  /** Signed out → login; wrong role → sign out first, then login. Either way the buyer returns here afterwards. */
  async function signInAsImporter() {
    setSwitching(true);
    if (gate.kind === 'wrong_role') await createClient().auth.signOut();
    router.replace(importerLoginUrl(pathname));
    router.refresh();
  }

  async function startTrial(pay: 'card' | 'mpesa') {
    setState('loading');
    setMethod(pay);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id, method: pay }),
      });
      const blocked = gateFromStatus(res.status, auth.profile?.role);
      if (blocked) { setServerGate(blocked); setState('idle'); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not start trial');
      // M-Pesa: the order page collects the phone number and sends the STK prompt.
      if (pay === 'mpesa') { router.push(`/dashboard/orders/${json.order.id}?pay=mpesa`); return; }
      // Hosted Flutterwave checkout; funds land in escrow, not with the supplier.
      if (json.paymentLink) { window.location.assign(json.paymentLink); return; }
      // Order saved but no link (provider hiccup) → order page offers "Pay now".
      router.push(`/dashboard/orders/${json.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start trial');
      setState('error');
    }
  }

  const lines = [
    { label: `Product · ${product.trial_units} units`, value: product.goods_cents },
    { label: 'Consolidated air freight', value: product.freight_cents },
    { label: 'Customs clearance & duties', value: product.customs_cents },
  ];
  const images = product.image_urls?.length ? product.image_urls : product.image_url ? [product.image_url] : [];
  const inCart = cart.has(product.id);

  /** Keep browsing: the cart is paid once, from the cart drawer → checkout. */
  function addToCart() {
    const result = cart.add({
      productId: product.id, title: product.title, supplierName: product.supplier_name,
      imageUrl: images[0] ?? null, category: product.category, landedCostCents: product.landed_cost_cents,
    });
    if (result === 'full') { setError(`Your cart holds up to ${CART_MAX_ITEMS} Trial Batches — check out or remove one first.`); return; }
    toast.success('Added to cart', { description: product.title, action: { label: 'View cart', onClick: () => cart.setOpen(true) } });
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
              ? 'Sign in with your importer account to pay with M-Pesa or card.'
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
          <CheckCircle2 className="h-4 w-4" /> Redirecting to secure checkout…
        </p>
      ) : (
        <div className="space-y-2">
          {/* M-Pesa is the primary method when enabled; card checkout is the fallback. */}
          {MPESA_ENABLED && (
            <button type="button" onClick={() => void startTrial('mpesa')} disabled={state === 'loading' || product.is_demo}
              className="btn-primary w-full bg-emerald-600 hover:bg-emerald-700" title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
              {state === 'loading' && method === 'mpesa' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Pay with M-Pesa
            </button>
          )}
          <div className={MPESA_ENABLED ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
            <button type="button" onClick={() => void startTrial('card')} disabled={state === 'loading' || product.is_demo}
              className={`${MPESA_ENABLED ? 'btn-secondary px-2' : 'btn-primary'} w-full`} title={product.is_demo ? 'Sample listing — run supabase/seed.sql to enable' : undefined}>
              {state === 'loading' && method === 'card' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {MPESA_ENABLED ? 'Card / bank' : 'Start trial with escrow'}
            </button>
            {cartButton}
          </div>
        </div>
      )}
      {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
    </>
  );

  return (
    <article className="group flex flex-col">
      {/* Clicking the photos opens the Quick View; swiping scrolls the gallery (touch swipes don't produce clicks). */}
      <div className="relative cursor-pointer overflow-hidden rounded-lg" onClick={() => setQuickView(true)}>
        <ProductGallery images={images} media={product.media} alt={product.title} category={product.category} className="aspect-square" arrows="hover" />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="pill border-transparent bg-white/95 text-neutral-900">$500 Trial Batch</span>
          {product.is_demo && <span className="pill border-amber-200 bg-amber-50 text-amber-800">Sample</span>}
        </div>
        {product.has_swatch_video && (
          <span className="pill pointer-events-none absolute bottom-3 left-3 border-transparent bg-neutral-900/80 text-white">
            <Film className="h-3.5 w-3.5" /> Swatch video
          </span>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); setQuickView(true); }}
          className="pill absolute right-3 top-3 border-transparent bg-white/95 text-neutral-900 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <Eye className="h-3.5 w-3.5" /> Quick view
        </button>
      </div>

      <div className="flex flex-1 flex-col pt-4">
        <p className="flex items-center gap-1.5 text-xs text-neutral-500">
          {flag(product.origin_country)} {product.supplier_name}
          {product.supplier_verified && (
            <span className="inline-flex items-center gap-0.5 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>
          )}
        </p>
        <h3 className="mt-1 text-base font-medium leading-snug text-neutral-900">
          <button type="button" onClick={() => setQuickView(true)} className="text-left underline-offset-4 hover:underline focus:outline-none focus-visible:underline">
            {product.title}
          </button>
        </h3>

        {/* Guaranteed Landed Cost breakdown — the core trust element */}
        <div className="mt-4 border-t border-neutral-200 pt-3">
          <dl className="space-y-1 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="flex justify-between text-neutral-500">
                <dt>{l.label}</dt><dd className="tabular-nums">{formatUSD(l.value, true)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-neutral-200 pt-2.5">
            <div>
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-neutral-900">
                <Lock className="h-3 w-3" /> Guaranteed Landed Cost
              </p>
              <p className="text-xs text-neutral-500">Delivered to your door · no surprise fees</p>
            </div>
            <p className="text-lg font-semibold tabular-nums text-neutral-900">{formatUSD(product.landed_cost_cents, true)}</p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
          <Timer className="h-3.5 w-3.5" />
          {product.lead_time_days ? `${product.lead_time_days}–${product.lead_time_days + 4} days` : 'Lead time on request'} from {countryName(product.origin_country)}
        </p>

        <div className="mt-auto pt-5">{actions}</div>
      </div>

      {quickView && <ProductQuickView product={product} onClose={() => setQuickView(false)} actions={actions} />}
    </article>
  );
}
