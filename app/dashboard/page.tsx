import { redirect } from 'next/navigation';
import { ArrowRight, BadgeCheck, Compass, Heart, Info, Lock, MessageSquare, Package, Plane, UserCheck, Users } from 'lucide-react';
import { PAID_ORDER_STATUSES } from '@/lib/order-status';
import { getSessionProfile } from '@/lib/supabase/server';
import type { EscrowStatus, GalleryMedia, OrderView, ProductCategory, TrendPoolView, TrialProductView } from '@/lib/types';
import { DEMO_POOLS, DEMO_PRODUCTS } from '@/lib/demo-data';
import { formatUSD } from '@/lib/format';
import { getSystemConfigs } from '@/lib/system-config-server';
import { minimumCents } from '@/lib/trial-batch';
import { checklist, type KycDoc } from '@/lib/kyc';
import KycBanner from '@/components/kyc/KycBanner';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import EscrowProtectionBanner from '@/components/dashboard/EscrowProtectionBanner';
import TrendPoolCard from '@/components/dashboard/TrendPoolCard';
import TrialBatchCard from '@/components/dashboard/TrialBatchCard';
import SupportWidget from '@/components/dashboard/SupportWidget';
import FeaturedCarousel, { type FeaturedSlide } from '@/components/dashboard/FeaturedCarousel';
import CategoryTiles, { type CategoryTile } from '@/components/dashboard/CategoryTiles';
import Link from 'next/link';
import QuickActions from '@/components/portal/QuickActions';
import { goldSupplierIds } from '@/lib/pricing-server';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';

export const metadata = { title: 'Buyer dashboard · SokoGlobal' };

type MediaRow = { public_url: string; media_type: 'image' | 'swatch_video'; sort_order?: number };
const allImages = (media: MediaRow[] | null | undefined) =>
  [...(media ?? [])].filter((m) => m.media_type === 'image').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((m) => m.public_url);
const firstImage = (media: MediaRow[] | null | undefined) => allImages(media)[0] ?? null;
/** Gallery slides: photos first (the card thumbnail stays a photo), then videos. */
const galleryMedia = (media: MediaRow[] | null | undefined): GalleryMedia[] => {
  const sorted = [...(media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return [
    ...sorted.filter((m) => m.media_type === 'image').map((m) => ({ type: 'image' as const, url: m.public_url })),
    ...sorted.filter((m) => m.media_type === 'swatch_video').map((m) => ({ type: 'video' as const, url: m.public_url })),
  ];
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Buyer (African Importer) dashboard — server-rendered; all reads go through RLS. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard');
  if (profile.role === 'supplier') redirect('/supplier');

  const [poolsRes, productsRes, ordersRes, myPoolsRes, followsRes] = await Promise.all([
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
      .select(`id, supplier_id, title, brand, category, origin_country, trial_units, unit_price_cents, trial_goods_cents,
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
      .in('escrow_status', PAID_ORDER_STATUSES)
      .order('created_at', { ascending: false })
      .limit(20), // support widget only — the order list lives at /dashboard/orders (header "My orders")
    supabase.from('pool_members').select('pool_id, contribution_cents, payment_status').eq('buyer_id', user.id),
    // Followed suppliers (migration 030; RLS returns only this user's rows). Errors before the migration → no feed.
    supabase.from('follows').select('following_id').order('created_at', { ascending: false }).limit(200),
  ]);
  const followedIds = followsRes.error ? null : (followsRes.data ?? []).map((f) => f.following_id as string);
  // "From suppliers you follow": their newest live listings (drafts stay private under "products: read live").
  const feedRows = followedIds?.length
    ? ((await supabase.from('products').select(CATALOG_PRODUCT_SELECT).in('supplier_id', followedIds).eq('status', 'live').is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(6)).data ?? []) as unknown as CatalogProductRow[]
    : [];

  const configs = await getSystemConfigs(supabase);
  // Banner state comes from profiles.kyc_status (the column every guard reads); documents only refine its copy.
  const showKycBanner = profile.role === 'importer' && configs.kyc.orders && !!profile.kyc_status && profile.kyc_status !== 'approved';
  const kycDocs = showKycBanner
    ? ((await supabase.from('kyc_verifications').select('document_type, status').eq('user_id', user.id)).data ?? []) as KycDoc[]
    : [];
  const kycChecklist = checklist(kycDocs);
  const kycApproved = (['identity', 'business'] as const).filter((g) => kycChecklist[g] === 'approved');
  const minTrialCents = minimumCents(configs.trial);
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

  const gold = await goldSupplierIds(supabase, [...(productsRes.data ?? []).map((p) => p.supplier_id as string), ...feedRows.map((r) => r.supplier_id)]);
  const feed = feedRows.map((r) => toTrialProductView(r, null, gold));
  const products: TrialProductView[] = (productsRes.data ?? []).map((p) => {
    const supplier = one(p.supplier as unknown as { company_name: string; kyc_verified: boolean });
    const media = (p.product_media ?? []) as MediaRow[];
    return {
      id: p.id, title: p.title, brand: p.brand, category: p.category, origin_country: p.origin_country,
      supplier_id: p.supplier_id as string, supplier_name: supplier?.company_name ?? 'Verified supplier', supplier_verified: !!supplier?.kyc_verified,
      supplier_gold: gold.has(p.supplier_id as string),
      trial_units: p.trial_units, unit_price_cents: p.unit_price_cents, goods_cents: p.trial_goods_cents,
      freight_cents: p.trial_freight_cents, customs_cents: p.trial_customs_cents,
      landed_cost_cents: p.trial_landed_cost_cents, lead_time_days: p.lead_time_days,
      image_url: firstImage(media), image_urls: allImages(media), media: galleryMedia(media),
      has_swatch_video: media.some((m) => m.media_type === 'swatch_video'),
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

  // Category browsing filters the products already loaded above (no extra query).
  const { category } = await searchParams;
  const activeCategory: ProductCategory | null = category === 'beauty' || category === 'clothing' || category === 'general' ? category : null;
  const shownProducts = activeCategory ? viewProducts.filter((p) => p.category === activeCategory) : viewProducts;
  const inCategory = (c: ProductCategory) => viewProducts.filter((p) => p.category === c);
  const imageOf = (c: ProductCategory) => inCategory(c).find((p) => p.image_url)?.image_url ?? null;
  const origins = (c: ProductCategory) => [...new Set(inCategory(c).map((p) => p.origin_country))].length;
  const CATEGORY_LABEL: Record<ProductCategory, string> = { beauty: 'Beauty', clothing: 'Clothing', general: 'Commodities' };

  const categoryTiles: CategoryTile[] = (['beauty', 'clothing', 'general'] as const)
    .filter((c) => inCategory(c).length > 0)
    .map((c) => ({
      key: c, label: CATEGORY_LABEL[c], category: c, image: imageOf(c), active: activeCategory === c,
      caption: `${inCategory(c).length} Trial Batch${inCategory(c).length === 1 ? '' : 'es'} · ${origins(c)} origin${origins(c) === 1 ? '' : 's'}`,
      href: `/dashboard?category=${c}#batches`,
    }));
  if (viewPools.length) {
    categoryTiles.push({
      key: 'pools', label: 'Trend Pools', category: viewPools[0].category, image: viewPools.find((p) => p.image_url)?.image_url ?? null,
      caption: `${viewPools.length} open · split freight with other boutiques`, href: '/dashboard#pools',
    });
  }

  const featuredSlides: FeaturedSlide[] = [
    ...(['beauty', 'clothing'] as const).filter((c) => inCategory(c).length > 0).map((c) => ({
      id: c, category: c, image: imageOf(c),
      eyebrow: `${CATEGORY_LABEL[c]} · Guaranteed Landed Cost`,
      title: c === 'beauty' ? 'Verified beauty lines, landed at your door' : 'Apparel trial batches, freight and customs included',
      body: `${inCategory(c).length} live Trial Batch${inCategory(c).length === 1 ? '' : 'es'} from ${origins(c)} origin countr${origins(c) === 1 ? 'y' : 'ies'}, each held in escrow until you verify the goods.`,
      href: `/dashboard?category=${c}#batches`, cta: `Shop ${CATEGORY_LABEL[c].toLowerCase()}`,
    })),
    ...(viewPools.length ? [{
      id: 'pools', category: viewPools[0].category, image: viewPools.find((p) => p.image_url)?.image_url ?? imageOf(viewPools[0].category),
      eyebrow: 'Trend Pools', title: 'Buy in bulk with other boutiques',
      body: `${viewPools.length} pool${viewPools.length === 1 ? '' : 's'} open now: pledge your share and split volumetric air freight.`,
      href: '/dashboard#pools', cta: 'See Trend Pools',
    }] : []),
  ];

  return (
    <>
      <DashboardHeader profile={profile} />

      {usingDemo && (
        <p className="flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          <Info className="h-3.5 w-3.5 shrink-0" /> Showing sample listings. Run <code className="font-mono">supabase/seed.sql</code> to load live data.
        </p>
      )}

      {/* Hero over the live wave wallpaper */}
      <div className="relative">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <p className="eyebrow">Welcome back, {profile.full_name.split(' ')[0]}</p>
          <div className="mt-4"><EscrowProtectionBanner /></div>
          {showKycBanner && profile.kyc_status && profile.kyc_status !== 'approved' && (
            <div className="mt-4"><KycBanner status={profile.kyc_status} approved={kycApproved} /></div>
          )}
          {!configs.trial.enabled && (
            <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">New trial batches are paused right now. Trend Pools and orders already placed are not affected.</p>
          )}
          <QuickActions className="mt-10" actions={[
            { href: '/dashboard/orders', label: 'My Orders', hint: 'Escrow & shipment tracking', icon: Package, tone: 'tone-escrow', badge: orders.length || undefined },
            { href: '/dashboard/discover', label: 'Catalogue', hint: 'Every category, filters & search', icon: Compass, tone: 'tone-muted' },
            { href: '/dashboard#batches', label: 'Trial Batches', hint: `Test a supplier from ${formatUSD(minTrialCents)}`, icon: Plane, tone: 'tone-transit' },
            { href: '/dashboard#pools', label: 'Trend Pools', hint: 'Split freight with boutiques', icon: Users, tone: 'tone-active' },
            { href: '/dashboard/messages', label: 'Messages', hint: 'Chat with suppliers', icon: MessageSquare, tone: 'tone-pending' },
            { href: '/dashboard/wishlist', label: 'Wishlist', hint: 'Saved products', icon: Heart, tone: 'tone-danger' },
          ]} />
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-20 px-4 py-14 sm:px-6 lg:px-8">
        {featuredSlides.length > 0 && <FeaturedCarousel slides={featuredSlides} />}

        {categoryTiles.length > 1 && (
          <section aria-labelledby="shop-by-category">
            <h2 id="shop-by-category" className="eyebrow mb-4">Shop by category</h2>
            <CategoryTiles tiles={categoryTiles} />
          </section>
        )}

        {/* Followed suppliers' newest listings (hidden until migration 030 is applied). */}
        {followedIds !== null && (
          <section id="following" aria-labelledby="following-title" className="scroll-mt-32">
            <SectionHeader icon={UserCheck} title="From suppliers you follow" titleId="following-title"
              subtitle="New Trial Batches from the suppliers you follow, newest first."
              aside={<Link href="/dashboard/discover" className="pill border-neutral-300 text-neutral-800 hover:border-neutral-900">Find suppliers <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>} />
            {feed.length > 0 ? (
              <div className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {feed.map((p) => <TrialBatchCard key={`f-${p.id}`} product={p} />)}
              </div>
            ) : (
              <p className="glass-card mt-6 px-6 py-8 text-center text-sm text-neutral-600">
                {followedIds.length
                  ? 'The suppliers you follow have no live listings right now. New ones will appear here.'
                  : 'Tap Follow next to a supplier’s name on any Trial Batch, and their new listings will show up here.'}
              </p>
            )}
          </section>
        )}

        {/* $500 Trial Batch listings — the product grid */}
        <section id="batches" className="scroll-mt-32">
          <SectionHeader
            icon={Plane}
            title={`Test a supplier with a ${formatUSD(minTrialCents)} Trial Batch`}
            subtitle="One fixed price covering the product, consolidated air freight and customs clearance — delivered to your door."
            aside={
              <div className="flex flex-wrap items-center gap-2">
                {activeCategory && (
                  <Link href="/dashboard#batches" scroll={false} className="pill border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700">
                    {CATEGORY_LABEL[activeCategory]} · Clear ×
                  </Link>
                )}
                <Link href="/dashboard/discover" className="pill border-neutral-300 text-neutral-800 hover:border-neutral-900">
                  Full catalogue <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <span className="pill tone-escrow hidden md:inline-flex"><Lock className="h-3.5 w-3.5" aria-hidden /> Escrow on every order</span>
                <span className="pill tone-active hidden md:inline-flex"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> KYC-verified sellers</span>
              </div>
            }
          />
          <div className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {shownProducts.map((p) => <TrialBatchCard key={p.id} product={p} />)}
          </div>
        </section>

        {/* Trend Pools */}
        <section id="pools" className="scroll-mt-32">
          <SectionHeader
            icon={Users}
            title="Trend Pools"
            subtitle="Team up with other boutiques to buy in bulk and split volumetric shipping costs."
          />
          <div className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {viewPools.map((p) => <TrendPoolCard key={p.id} pool={p} />)}
          </div>
        </section>
      </main>

      <SupportWidget orders={orders} />
    </>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, aside, titleId }: {
  icon: typeof Users; title: string; subtitle: string; aside?: React.ReactNode; titleId?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
      <div className="max-w-2xl">
        <span className="grid h-10 w-10 place-items-center rounded-lg border tone-active">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 id={titleId} className="mt-3 text-2xl font-semibold text-neutral-900">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}
