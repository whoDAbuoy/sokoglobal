import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import Price, { LocalPreview } from '@/components/currency/Price';
import { UUID_RE } from '@/lib/uploads';
import type { ProductCategory } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ProductVisual from '@/components/dashboard/ProductVisual';
import CheckoutActions from './CheckoutActions';
import { getPaymentSettings, methodsFor } from '@/lib/payment-settings-server';

export const metadata = { title: 'Checkout · SokoGlobal' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; escrow_status: string; total_cents: number; goods_cents: number; freight_cents: number; customs_cents: number;
  quantity: number; escrow_fee_cents?: number | null;
  product: { title: string; category: ProductCategory; trial_units: number; product_media: { public_url: string; media_type: string; sort_order: number }[] } | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Cart checkout (also the return page after a Bank Card payment). Escrow
 * state comes from the database: only the verified webhook / STK Query result
 * can fund the orders.
 */
export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; gw?: string; token?: string; TransactionToken?: string }>;
}) {
  const [{ id }, { status: returnStatus, gw, token: paypalToken, TransactionToken: dpoToken }] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/dashboard/checkout/${id}`);

  const { data: group } = await supabase
    .from('checkout_groups')
    .select(`id, buyer_id, created_at, funded_at, payment_provider,
             orders ( id, escrow_status, quantity, total_cents, goods_cents, freight_cents, customs_cents, escrow_fee_cents,
                      product:products ( title, category, trial_units, product_media ( public_url, media_type, sort_order ) ) )`)
    .eq('id', id)
    .maybeSingle();
  if (!group || group.buyer_id !== user.id) notFound();

  const orders = ((group.orders ?? []) as unknown as Row[]).map((o) => ({ ...o, product: one(o.product) }));
  const unpaid = orders.filter((o) => o.escrow_status === 'pending_payment');
  const due = unpaid.reduce((s, o) => s + o.total_cents, 0);
  const total = orders.reduce((s, o) => s + o.total_cents, 0);
  const sum = (k: 'goods_cents' | 'freight_cents' | 'customs_cents' | 'escrow_fee_cents') => orders.reduce((s, o) => s + (o[k] ?? 0), 0);
  // Migration 028: online methods switched on + configured + within limits (wire and crypto are per order).
  const payments = await getPaymentSettings(supabase);
  const methods = methodsFor({ settings: payments.settings, fxSpread: payments.fxSpread, dueCents: due, cart: true });
  const gatewayReturn = gw === 'paypal' && paypalToken ? { gateway: 'paypal' as const, token: paypalToken }
    : gw === 'dpo' && dpoToken ? { gateway: 'dpo' as const, token: dpoToken } : null;
  const batchesOf = (o: Row) => (o.product?.trial_units ? Math.max(1, Math.round(o.quantity / o.product.trial_units)) : 1);
  const totalBatches = orders.reduce((n, o) => n + batchesOf(o), 0);
  const image = (o: Row) => [...(o.product?.product_media ?? [])].filter((m) => m.media_type === 'image').sort((a, b) => a.sort_order - b.sort_order)[0]?.public_url ?? null;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div aria-hidden className="ambient-glow -z-10 right-0 top-40 h-80 w-80 bg-blue-600/10" />
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-neutral-500 transition-colors hover:text-neutral-900">
          <ArrowLeft className="h-4 w-4" /> Continue browsing
        </Link>
        <div className="mt-6 border-b border-black/[0.06] pb-6 dark:border-snow/[0.08]">
          <p className="eyebrow">Checkout #{group.id.slice(0, 8).toUpperCase()} · {totalBatches} Trial Batch{totalBatches === 1 ? '' : 'es'}</p>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-900">{unpaid.length ? 'Review & pay' : 'Paid into escrow'}</h1>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <ul className="glass-card divide-y divide-black/[0.06] px-5 dark:divide-snow/[0.08]">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/dashboard/orders/${o.id}`} className="press-card group flex items-center gap-4 py-4">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                      <ProductVisual src={image(o)} alt={o.product?.title ?? 'Trial Batch'} category={o.product?.category ?? 'beauty'} className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-neutral-900 group-hover:underline">
                        {batchesOf(o) > 1 && <span className="mr-1.5 tabular-nums text-neutral-500">{batchesOf(o)} ×</span>}
                        {o.product?.title ?? 'Trial Batch'}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Order #{o.id.slice(0, 8).toUpperCase()} · {o.quantity} units ·{' '}
                        <span className={o.escrow_status === 'pending_payment' ? 'text-amber-700' : 'text-emerald-700'}>
                          {o.escrow_status === 'pending_payment' ? 'Awaiting payment' : o.escrow_status.replace(/_/g, ' ')}
                        </span>
                      </p>
                    </div>
                    <Price cents={o.total_cents} className="text-sm font-semibold tabular-nums text-neutral-900" />
                    <ArrowRight className="h-4 w-4 text-neutral-400" />
                  </Link>
                </li>
              ))}
            </ul>

            {unpaid.length > 0 ? (
              <CheckoutActions checkoutId={group.id} returnStatus={returnStatus ?? null}
                amountLabel={formatUSD(due, true)} buyerName={profile.full_name} methods={methods} gatewayReturn={gatewayReturn} />
            ) : (
              <p className="mt-6 flex items-center gap-2 rounded-2xl border p-4 text-sm tone-escrow">
                <CheckCircle2 className="h-5 w-5" /> All {totalBatches} Trial Batches are paid and held in escrow. Track each one from its order page.
              </p>
            )}
          </div>

          <aside className="lg:sticky lg:top-32 lg:self-start">
            <section className="glass-card p-6">
              <h2 className="eyebrow">Order summary</h2>
              <dl className="mt-5 space-y-3 text-sm text-neutral-600">
                {[['Products', sum('goods_cents')], ['Consolidated air freight', sum('freight_cents')], ['Customs clearance & duties', sum('customs_cents')]]
                  .concat(sum('escrow_fee_cents') > 0 ? [['Escrow protection fee', sum('escrow_fee_cents')]] : []).map(([l, v]) => (
                  <div key={l as string} className="flex justify-between"><dt>{l}</dt><dd className="tabular-nums text-neutral-900">{formatUSD(v as number, true)}</dd></div>
                ))}
                <div className="flex items-baseline justify-between border-t border-black/[0.06] pt-4 text-neutral-900 dark:border-snow/[0.08]">
                  <dt className="font-medium">{unpaid.length && unpaid.length < orders.length ? 'Left to pay' : 'Total'}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatUSD(unpaid.length ? due : total, true)}</dd>
                </div>
                <LocalPreview cents={unpaid.length ? due : total} className="block text-right text-xs tabular-nums text-neutral-500" />
              </dl>
              <p className="mt-4 flex items-start gap-1.5 text-xs text-neutral-500">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
                Each Trial Batch has its own escrow: a supplier is paid only after you verify their goods.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
