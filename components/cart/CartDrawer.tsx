'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, LogIn, ShieldCheck, ShoppingBag, Trash2, X } from 'lucide-react';
import { CART_MAX_ITEMS, useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useCurrency } from '@/context/CurrencyContext';
import { ROLE_LABEL, checkoutGate, gateFromStatus, importerLoginUrl, type CheckoutGate } from '@/lib/checkout-gate';
import ProductVisual from '@/components/dashboard/ProductVisual';
import QuantityStepper from '@/components/cart/QuantityStepper';

/**
 * Cart drawer + floating cart bar (buyer pages only). Checkout turns the cart
 * into one escrow order per item and opens /dashboard/checkout/:id, where the
 * whole cart is paid once with M-Pesa or card.
 */
export default function CartDrawer() {
  const { formatUsd, currency } = useCurrency();
  const cart = useCart();
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverGate, setServerGate] = useState<CheckoutGate | null>(null);
  const gate = serverGate ?? checkoutGate({ loading: auth.loading, signedIn: !!auth.user, role: auth.profile?.role });

  const onBuyerPage = pathname.startsWith('/dashboard') && !pathname.startsWith('/dashboard/checkout');
  const count = cart.items.length;

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (cart.open && !d.open) d.showModal();
    if (!cart.open && d.open) d.close();
  }, [cart.open]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!cart.open) return;
    const html = document.documentElement;
    const prev = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    const gap = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingRight = `${gap}px`;
    return () => { html.style.overflow = prev.overflow; html.style.paddingRight = prev.paddingRight; };
  }, [cart.open]);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }),
      });
      const blocked = gateFromStatus(res.status, auth.profile?.role);
      if (blocked) { setServerGate(blocked); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not start checkout');
      cart.clear();
      cart.setOpen(false);
      router.push(`/dashboard/checkout/${json.checkout.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout');
    } finally {
      setBusy(false);
    }
  }

  async function signInAsImporter() {
    if (gate.kind === 'wrong_role') await createClient().auth.signOut();
    cart.setOpen(false);
    router.replace(importerLoginUrl(pathname));
    router.refresh();
  }

  return (
    <>
      {/* Floating cart bar: keeps the cart in reach while browsing. */}
      {onBuyerPage && count > 0 && !cart.open && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <button type="button" onClick={() => cart.setOpen(true)}
            className="glass-toolbar press pointer-events-auto flex w-full max-w-md items-center justify-between gap-4 !rounded-full py-2.5 pl-5 pr-2.5 text-sm text-neutral-900 hover:border-blue-500/30 motion-safe:animate-slide-up">
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              {cart.batchCount} Trial Batch{cart.batchCount === 1 ? '' : 'es'} · <span className="font-semibold tabular-nums">{formatUsd(cart.subtotalCents)}</span>
            </span>
            <span className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-snow">
              View cart <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      )}

      <dialog ref={dialogRef} aria-labelledby="cart-title"
        onClose={() => cart.setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) cart.setOpen(false); }}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md border-l border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10 motion-safe:animate-slide-in-right backdrop:motion-safe:animate-fade-in">
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-5">
            <div>
              <h2 id="cart-title" className="text-lg font-semibold text-neutral-900">Your cart</h2>
              <p className="text-xs text-neutral-500">{cart.batchCount} Trial Batch{cart.batchCount === 1 ? '' : 'es'} · {count} of {CART_MAX_ITEMS} products · escrow per product</p>
            </div>
            <button type="button" onClick={() => cart.setOpen(false)} aria-label="Close cart"
              className="grid h-9 w-9 place-items-center rounded-full text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900">
              <X className="h-4 w-4" />
            </button>
          </header>

          {count === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <ShoppingBag className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
              <p className="mt-3 font-medium text-neutral-900">Your cart is empty</p>
              <p className="mt-1 text-sm text-neutral-500">Add Trial Batches from any product card or Quick View.</p>
              <button type="button" onClick={() => cart.setOpen(false)} className="btn-secondary mt-6">Continue browsing</button>
            </div>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-neutral-200 overflow-y-auto overscroll-contain px-6">
                {cart.items.map((item) => (
                  <li key={item.productId} className="flex gap-4 py-4">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md">
                      <ProductVisual src={item.imageUrl} alt={item.title} category={item.category} className="h-full w-full" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-xs text-neutral-500">{item.supplierName}</p>
                      <p className="line-clamp-2 text-sm font-medium text-neutral-900">{item.title}</p>
                      <p className="text-xs tabular-nums text-neutral-500">{formatUsd(item.landedCostCents)} per batch</p>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <QuantityStepper value={item.quantity} onChange={(q) => cart.setQuantity(item.productId, q)} label={`Trial Batches of ${item.title}`} size="sm" />
                        <span className="text-sm font-semibold tabular-nums text-neutral-900">{formatUsd(item.landedCostCents * item.quantity)}</span>
                      </div>
                      <div className="flex justify-end pt-1">
                        <button type="button" onClick={() => cart.remove(item.productId)} aria-label={`Remove ${item.title}`}
                          className="inline-flex items-center gap-1 text-xs text-neutral-500 transition hover:text-red-700">
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <footer className="border-t border-neutral-200 bg-neutral-50 px-6 py-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-neutral-600">Guaranteed Landed Cost total</span>
                  <span className="text-xl font-semibold tabular-nums text-neutral-900">{formatUsd(cart.subtotalCents)}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Product, air freight and customs included. Prices are confirmed at checkout, where the escrow protection fee is shown before you pay.
                  {currency !== 'USD' && <> Shown in {currency} at today&apos;s rate; escrow is held in USD.</>}
                </p>

                {gate.kind === 'signed_out' || gate.kind === 'wrong_role' ? (
                  <div role="status" className="mt-4 rounded-md border border-neutral-200 bg-white p-4 text-sm">
                    <p className="font-medium text-neutral-900">{gate.kind === 'signed_out' ? 'Sign in to check out' : 'Purchases need an Importer account'}</p>
                    {gate.kind === 'wrong_role' && <p className="mt-1 text-neutral-600">You&apos;re signed in as {ROLE_LABEL[gate.role]}.</p>}
                    <button type="button" onClick={() => void signInAsImporter()} className="btn-primary mt-3 w-full">
                      <LogIn className="h-4 w-4" /> {gate.kind === 'signed_out' ? 'Sign in to check out' : 'Sign in as an importer'}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => void checkout()} disabled={busy} className="btn-primary mt-4 w-full py-3">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Checkout · pay with M-Pesa or card
                  </button>
                )}
                {error && <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
                <button type="button" onClick={() => cart.setOpen(false)} className="mt-3 w-full text-center text-sm text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline">
                  Continue browsing
                </button>
              </footer>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
