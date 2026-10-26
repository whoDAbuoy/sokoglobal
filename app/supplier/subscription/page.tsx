import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, Check, Crown, Loader2 } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import { dollarsToCents, formatRate, goldState } from '@/lib/pricing';
import { getPricing } from '@/lib/pricing-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import BankCardPanel from '@/components/payments/BankCardPanel';
import GoldBadge from '@/components/supplier/GoldBadge';

export const metadata = { title: 'Gold Supplier · SokoGlobal' };
export const dynamic = 'force-dynamic';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Free vs Gold Supplier. Prices come from platform_settings (migration 026); the
 * card charge is priced again in Postgres (begin_card_purchase) and a month of
 * Gold starts only when Paystack confirms it. No auto-renewal: each payment adds a month.
 */
export default async function SupplierSubscriptionPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/subscription');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const [{ pricing: p, available }, { data: sub }] = await Promise.all([
    getPricing(supabase),
    supabase.from('subscriptions').select('status, current_period_end').eq('user_id', user.id).eq('plan_type', 'gold_supplier').maybeSingle(),
  ]);
  const gold = goldState(sub as { status: string; current_period_end: string | null } | null);
  const priceCents = dollarsToCents(p.supplier_gold_monthly_price);
  const processing = status === 'processing' && gold.kind !== 'active';

  const plans = [
    {
      name: 'Free', price: formatUSD(0, true), current: gold.kind !== 'active',
      features: [`${formatRate(p.default_supplier_commission_rate)} commission on the goods value`, 'Escrow-protected orders and payouts', 'Quote on buyer requests in your categories', 'Order chat with buyers'],
    },
    {
      name: 'Gold Supplier', price: `${formatUSD(priceCents, true)} / month`, current: gold.kind === 'active',
      features: [`${formatRate(p.supplier_gold_commission_rate)} commission on orders placed while you're Gold`, '“Gold Supplier” badge on your listings and quotes', 'Everything in Free'],
    },
  ];

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <p className="eyebrow mt-4">Membership</p>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold text-neutral-900">
          Gold Supplier {gold.kind === 'active' && <GoldBadge />}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-600">
          Keep more of every order and stand out to buyers. Gold is a paid membership: the badge shows buyers you&apos;re a Gold member,
          while the green <span className="font-medium">Verified</span> mark still comes only from business verification (KYC).
        </p>

        {!available && (
          <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Gold Supplier isn&apos;t available yet. Please check back soon.</p>
        )}
        {processing && (
          <p role="status" className="mt-6 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm tone-active">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Confirming your payment with Paystack — this page updates once it&apos;s through. Refresh in a moment.
          </p>
        )}
        {gold.kind === 'active' && (
          <p role="status" className="mt-6 rounded-xl border px-4 py-3 text-sm tone-escrow">
            You&apos;re Gold until <strong>{day(gold.until)}</strong>. Paying again adds another month to that date.
          </p>
        )}
        {gold.kind === 'lapsed' && (
          <p role="status" className="mt-6 rounded-xl border px-4 py-3 text-sm tone-pending">Your Gold membership ended on {day(gold.endedAt)}. Renew to get the lower commission back on new orders.</p>
        )}

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <section key={plan.name} aria-labelledby={`plan-${plan.name}`}
              className={clsx('card p-6', plan.name !== 'Free' && 'ring-1 ring-yellow-500/40')}>
              <div className="flex items-start justify-between gap-3">
                <h2 id={`plan-${plan.name}`} className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
                  {plan.name !== 'Free' && <Crown className="h-5 w-5 text-yellow-600 dark:text-yellow-300" aria-hidden />}{plan.name}
                </h2>
                {plan.current && <span className="pill tone-muted">Current plan</span>}
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-neutral-900">{plan.price}</p>
              <ul className="mt-4 space-y-2 text-sm text-neutral-700">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{f}</li>
                ))}
              </ul>
              {plan.name !== 'Free' && available && (
                <div className="mt-6 border-t border-neutral-200 pt-5">
                  <p className="mb-3 text-sm text-neutral-600">
                    {gold.kind === 'active' ? 'Add a month' : 'Start Gold'}: one month for {formatUSD(priceCents, true)}. No automatic renewal.
                  </p>
                  <BankCardPanel endpoint="/api/subscriptions/checkout" amountLabel={formatUSD(priceCents, true)}
                    returnPath="/supplier/subscription" defaultName={profile.full_name} />
                </div>
              )}
            </section>
          ))}
        </div>
        <p className="mt-6 text-xs text-neutral-500">
          The commission rate is fixed per order when the buyer places it. Card payments in a currency other than USD include an FX margin of {formatRate(p.fx_spread_percent)}.
        </p>
      </main>
    </>
  );
}
