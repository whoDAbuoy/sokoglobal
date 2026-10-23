import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowRight, Coins, Crown, Landmark, Megaphone, Percent, Repeat, ShieldAlert, Truck, Zap } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/auth/admin-access';
import { formatUSD } from '@/lib/format';
import { formatRate, parseRevenue, revenueTotals, type RevenueSummary } from '@/lib/pricing';
import { getPricing } from '@/lib/pricing-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { KpiCard, MiniStat, Panel } from '@/components/admin/overview/Widgets';
import PricingForm from '@/components/admin/financials/PricingForm';
import PaymentSettingsForm from '@/components/admin/financials/PaymentSettingsForm';
import ManualPaymentsQueue, { type QueueRow } from '@/components/admin/financials/ManualPaymentsQueue';
import { getPaymentSettings } from '@/lib/payment-settings-server';
import { isDpoConfigured } from '@/lib/payments/dpo';
import { isPaypalConfigured } from '@/lib/payments/paypal';
import { isAirtelConfigured } from '@/lib/payments/airtel';
import { financialOverrideBlock } from '@/lib/security/two-factor-gate';
import { twoFactorState } from '@/lib/security/two-factor-server';

export const metadata = { title: 'Financials · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const money = (cents: number) => formatUSD(cents, true);

/**
 * Super-admin financial desk: platform revenue by stream (super_platform_revenue(),
 * migration 026) and the live pricing every charge is computed from. 404 for
 * everyone else; Postgres re-checks is_super_admin() on every read and write.
 */
export default async function FinancialsPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/financials');
  if (!isSuperAdmin(profile)) notFound();

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [pricing, allTime, last30, payments, queueRes, twoFactor] = await Promise.all([
    getPricing(supabase),
    supabase.rpc('super_platform_revenue', { p_since: null }),
    supabase.rpc('super_platform_revenue', { p_since: since30 }),
    getPaymentSettings(supabase),
    supabase.from('manual_payments')
      .select(`id, method, network, leg, usd_cents, fee_cents, charge_cents, reference, tx_hash, proof_path, submitted_at, order_id,
               order:orders ( product:products ( title ) ), buyer:profiles!manual_payments_buyer_id_fkey ( company_name, full_name )`)
      .eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(100),
    twoFactorState(supabase),
  ]);
  // Proofs live in the private payment-proofs bucket: short-lived signed links for the reviewer.
  const queue = (queueRes.data ?? []) as unknown as (Omit<QueueRow, 'product_title' | 'buyer' | 'proof_url'> & { proof_path: string | null; order: unknown; buyer: unknown })[];
  const proofPaths = queue.map((q) => q.proof_path).filter((p): p is string => !!p);
  const signed = proofPaths.length ? (await supabase.storage.from('payment-proofs').createSignedUrls(proofPaths, 600)).data ?? [] : [];
  const signedBy = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const queueRows: QueueRow[] = queue.map((q) => {
    const buyer = one(q.buyer as { company_name: string; full_name: string } | null);
    return { ...q, product_title: one(one(q.order as { product: unknown } | null)?.product as { title: string } | null)?.title ?? null,
      buyer: buyer ? `${buyer.company_name} (${buyer.full_name})` : 'Buyer', proof_url: q.proof_path ? signedBy.get(q.proof_path) ?? null : null };
  });
  const migrationMissing = !pricing.available || !!allTime.error;
  const all: RevenueSummary = parseRevenue(allTime.data);
  const month: RevenueSummary = parseRevenue(last30.data);
  const totals = { all: revenueTotals(all), month: revenueTotals(month) };
  const p = pricing.pricing;

  const recent = (cents: number) => <p className="mt-1 text-xs text-neutral-500"><span className="font-semibold tabular-nums text-neutral-700">{money(cents)}</span> in the last 30 days</p>;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Internal · Super admin</p>
            <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-neutral-900"><Landmark className="h-7 w-7 text-neutral-500" aria-hidden /> Financials</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-600">
              What SokoGlobal earns, and the prices and margins every new charge is computed from.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500">Platform revenue, all time</p>
            <p className="text-2xl font-semibold tabular-nums text-neutral-900">{money(totals.all.total)}</p>
            <p className="text-xs text-neutral-500"><span className="tabular-nums">{money(totals.month.total)}</span> in the last 30 days</p>
          </div>
        </div>

        {migrationMissing && (
          <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Run <code className="font-mono">supabase/migrations/026_platform_monetization.sql</code> to enable pricing controls and revenue tracking. Defaults are shown.
          </p>
        )}

        <section aria-labelledby="revenue" className="mt-6">
          <h2 id="revenue" className="sr-only">Revenue by stream</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={Crown} value={money(all.subscriptions_cents)} label="Subscriptions">
              <p className="mt-1 text-xs text-neutral-500"><span className="font-semibold tabular-nums text-neutral-700">{all.active_gold_suppliers}</span> active Gold supplier{all.active_gold_suppliers === 1 ? '' : 's'} · {money(month.subscriptions_cents)} in 30 days</p>
            </KpiCard>
            <KpiCard icon={Percent} value={money(all.escrow_fees_cents)} label="Escrow fees">{recent(month.escrow_fees_cents)}</KpiCard>
            <KpiCard icon={Repeat} value={money(all.fx_margin_cents)} label="FX margins">{recent(month.fx_margin_cents)}</KpiCard>
            <KpiCard icon={Megaphone} value={money(totals.all.rfqPromotions)} label="RFQ promotions">
              <p className="mt-1 text-xs text-neutral-500">Featured {money(all.rfq_featured_cents)} · White-glove {money(all.rfq_white_glove_cents)}</p>
            </KpiCard>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel>
              <h3 className="font-semibold text-neutral-900">Other streams</h3>
              <p className="text-xs text-neutral-500">Commission and early-payout fees count once the supplier payout succeeds; escrow fees and markup once an order is funded (refunded orders excluded).</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat icon={Landmark} label="Supplier commission" value={money(all.commission_cents)} />
                <MiniStat icon={Truck} label="Logistics markup" value={money(all.logistics_markup_cents)} />
                <MiniStat icon={Zap} label="Early-payout fees" value={money(all.early_payout_fees_cents)} />
                <MiniStat icon={Coins} label="Crypto handling fees" value={money(all.crypto_fees_cents)} />
              </div>
            </Panel>
            <Panel>
              <h3 className="flex items-center gap-2 font-semibold text-neutral-900"><ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden /> Exposure &amp; queues</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-neutral-600">Paid out early, not yet confirmed by the buyer</dt><dd className="font-semibold tabular-nums text-neutral-900">{money(all.early_payout_exposure_cents)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-neutral-600">Open early payouts</dt><dd className="tabular-nums text-neutral-900">{all.early_payouts_open}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-neutral-600">Open white-glove requests</dt><dd className="tabular-nums text-neutral-900">{all.white_glove_open}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-neutral-600">Wire / crypto payments to review</dt><dd className="tabular-nums text-neutral-900">{all.manual_payments_pending}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-neutral-500">If a buyer disputes an order that was paid out early, the refund comes from platform funds.</p>
              <Link href="/admin/support" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-neutral-900">White-glove tickets are in Support <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
            </Panel>
          </div>
        </section>

        <section aria-labelledby="manual-queue" className="mt-10">
          <h2 id="manual-queue" className="text-xl font-semibold text-neutral-900">Wire &amp; crypto approvals</h2>
          <p className="mb-4 mt-1 text-sm text-neutral-600">Bank receipts and transaction hashes buyers have submitted. Oldest first.</p>
          <ManualPaymentsQueue rows={queueRows} moneyBlocked={financialOverrideBlock(twoFactor)} />
        </section>

        <section aria-labelledby="gateways" className="mt-10">
          <h2 id="gateways" className="text-xl font-semibold text-neutral-900">Payment gateways</h2>
          <p className="mb-4 mt-1 text-sm text-neutral-600">Turn channels on or off instantly, and set the escrow bank account and wallets buyers pay into.</p>
          {payments.available
            ? <PaymentSettingsForm settings={payments.settings} updatedAt={payments.updatedAt}
                configured={{ dpo: isDpoConfigured(), paypal: isPaypalConfigured(), airtel: isAirtelConfigured() }} />
            : <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Run <code className="font-mono">supabase/migrations/028_payment_gateways_expansion.sql</code> to enable payment gateway controls.</p>}
        </section>

        <section aria-labelledby="pricing" className="mt-10">
          <div className="mb-4">
            <h2 id="pricing" className="text-xl font-semibold text-neutral-900">Pricing controls</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Today: Gold {money(Math.round(p.supplier_gold_monthly_price * 100))}/month at {formatRate(p.supplier_gold_commission_rate)} commission
              (standard {formatRate(p.default_supplier_commission_rate)}) · escrow fee {formatRate(p.escrow_fee_percent)} · FX spread {formatRate(p.fx_spread_percent)}.
            </p>
          </div>
          <PricingForm pricing={p} updatedAt={pricing.updatedAt} />
        </section>
      </main>
    </>
  );
}
