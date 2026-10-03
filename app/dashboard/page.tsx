import { redirect } from 'next/navigation';
import { BadgeCheck, Info, Lock, Plane, Users } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, OrderView, ProductCategory, TrendPoolView, TrialProductView } from '@/lib/types';
import { DEMO_ORDERS, DEMO_POOLS, DEMO_PRODUCTS } from '@/lib/demo-data';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowProtectionBanner from '@/components/dashboard/EscrowProtectionBanner';
import TrendPoolCard from '@/components/dashboard/TrendPoolCard';
import TrialBatchCard from '@/components/dashboard/TrialBatchCard';
import EscrowTracker from '@/components/dashboard/EscrowTracker';
import SupportWidget from '@/components/dashboard/SupportWidget';

export const metadata = { title: 'Buyer dashboard · SokoGlobal' };

type MediaRow = { public_url: string; media_type: 'image' | 'swatch_video'; sort_order?: number };
const firstImage = (media: MediaRow[] | null | undefined) =>
  [...(media ?? [])].filter((m) => m.media_type === 'image').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.public_url ?? null;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Buyer (African Importer) dashboard — server-rendered; all reads go through RLS. */
export default async function DashboardPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard');
  if (profile.role === 'supplier') redirect('/supplier');

  const [poolsRes, productsRes, ordersRes, myPoolsRes] = await Promise.all([
    supabase
      .from('trend_pools')
      .select(`id, title, description, destination_country, target_cents, pledged_cents, min_contribution_cents,
               freight_total_cents, member_count, max_members, deadline, status,
               product:products ( category, origin_country, product_media ( public_url, media_type, sort_order ) )`)
      .in('status', ['open', 'funded'])
      .order('deadline', { ascending: true })
      .limit(6),
    supabase
      .from('products')
      .select(`id, title, brand, category, origin_country, trial_units, unit_price_cents, trial_goods_cents,
               trial_freight_cents, trial_customs_cents, trial_landed_cost_cents, lead_time_days,
               supplier:profiles!products_supplier_id_fkey ( company_name, kyc_verified ),
               product_media ( public_url, media_type, sort_order )`)
      .eq('status', 'live')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('orders')
      .select('id, order_type, escrow_status, total_cents, created_at, product:products ( title )')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('pool_members').select('pool_id, contribution_cents, payment_status').eq('buyer_id', user.id),
  ]);

  const myPools = new Map((myPoolsRes.data ?? []).map((m) => [m.pool_id as string, m as { contribution_cents: number; payment_status: EscrowStatus }]));

  const pools: TrendPoolView[] = (poolsRes.data ?? []).map((p) => {
    const product = one(p.product as unknown as { category: ProductCategory; origin_country: string; product_media: MediaRow[] });
    return {
      id: p.id, title: p.title, description: p.description, destination_country: p.destination_country,
      target_cents: p.target_cents, pledged_cents: p.pledged_cents, min_contribution_cents: p.min_contribution_cents,
      freight_total_cents: p.freight_total_cents, member_count: p.member_count, max_members: p.max_members,
      deadline: p.deadline, status: p.status,
      category: product?.category ?? 'beauty', origin_country: product?.origin_country ?? 'US',
      image_url: firstImage(product?.product_media), my_contribution_cents: myPools.get(p.id)?.contribution_cents ?? 0,
      my_payment_status: myPools.get(p.id)?.payment_status ?? null,
    };
  });

  const products: TrialProductView[] = (productsRes.data ?? []).map((p) => {
    const supplier = one(p.supplier as unknown as { company_name: string; kyc_verified: boolean });
    const media = (p.product_media ?? []) as MediaRow[];
    return {
      id: p.id, title: p.title, brand: p.brand, category: p.category, origin_country: p.origin_country,
      supplier_name: supplier?.company_name ?? 'Verified supplier', supplier_verified: !!supplier?.kyc_verified,
      trial_units: p.trial_units, unit_price_cents: p.unit_price_cents, goods_cents: p.trial_goods_cents,
      freight_cents: p.trial_freight_cents, customs_cents: p.trial_customs_cents,
      landed_cost_cents: p.trial_landed_cost_cents, lead_time_days: p.lead_time_days,
      image_url: firstImage(media), has_swatch_video: media.some((m) => m.media_type === 'swatch_video'),
    };
  });

  const orders: OrderView[] = (ordersRes.data ?? []).map((o) => ({
    id: o.id, order_type: o.order_type, escrow_status: o.escrow_status, total_cents: o.total_cents, created_at: o.created_at,
    product_title: one(o.product as unknown as { title: string })?.title ?? 'Product',
  }));

  // Fresh project with no data yet → show labelled sample content.
  const usingDemo = pools.length === 0 && products.length === 0;
  const viewPools = usingDemo ? DEMO_POOLS : pools;
  const viewProducts = usingDemo ? DEMO_PRODUCTS : products;
  const viewOrders = usingDemo && orders.length === 0 ? DEMO_ORDERS : orders;

  return (
    <>
      <DashboardHeader profile={profile} />

      <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-6 lg:px-8">
        {usingDemo && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-600/20">
            <Info className="h-4 w-4 shrink-0" /> Showing sample listings. Run <code className="font-mono text-xs">supabase/seed.sql</code> to load live data.
          </p>
        )}

        <div>
          <p className="text-sm text-slate-500">Welcome back, {profile.full_name.split(' ')[0]}</p>
          <div className="mt-4"><EscrowProtectionBanner /></div>
        </div>

        {/* Trend Pools */}
        <section id="pools" className="scroll-mt-24">
          <SectionHeader
            icon={Users}
            title="Trend Pools"
            subtitle="Team up with other boutiques to buy in bulk and split volumetric shipping costs."
          />
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {viewPools.map((p) => <TrendPoolCard key={p.id} pool={p} />)}
          </div>
        </section>

        {/* $500 Trial Batch listings */}
        <section>
          <SectionHeader
            icon={Plane}
            title="Test a supplier with a $500 Trial Batch"
            subtitle="One fixed price covering the product, consolidated air freight and customs clearance — delivered to your door."
            aside={
              <div className="hidden items-center gap-4 text-xs text-slate-600 md:flex">
                <span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5 text-emerald-600" /> Escrow on every order</span>
                <span className="flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5 text-brand-600" /> KYC-verified sellers</span>
              </div>
            }
          />
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {viewProducts.map((p) => <TrialBatchCard key={p.id} product={p} />)}
          </div>
        </section>

        {/* Escrow tracker */}
        <section id="orders" className="scroll-mt-24">
          <SectionHeader icon={Lock} title="Your orders in escrow" subtitle="Track every shipment from payment to doorstep verification." />
          <div className="mt-5 max-w-3xl"><EscrowTracker orders={viewOrders} /></div>
        </section>
      </main>

      <SupportWidget orders={orders} />
    </>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, aside }: {
  icon: typeof Users; title: string; subtitle: string; aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 ring-1 ring-brand-100">
          <Icon className="h-4 w-4 text-brand-700" />
        </span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {aside}
    </div>
  );
}
