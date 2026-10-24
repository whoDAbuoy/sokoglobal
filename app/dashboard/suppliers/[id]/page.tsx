import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CalendarDays, Package, Users } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { countryName, flag } from '@/lib/format';
import { followerLabel } from '@/lib/follows';
import { initials } from '@/lib/admin-inbox';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';
import { goldSupplierIds } from '@/lib/pricing-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import TrialBatchCard from '@/components/dashboard/TrialBatchCard';
import FollowButton from '@/components/follow/FollowButton';
import GoldBadge from '@/components/supplier/GoldBadge';

export const metadata = { title: 'Supplier · SokoGlobal' };
export const dynamic = 'force-dynamic';

/**
 * Public supplier profile for signed-in users: identity, verification, follower count and
 * live listings. Every read goes through RLS ("profiles: read suppliers", "products: read live",
 * "follows: read own"); the count comes from supplier_follower_count() and never lists followers.
 */
export default async function SupplierProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/dashboard/suppliers/${id}`);

  const [supplierRes, productsRes, countRes, followRes, gold] = await Promise.all([
    supabase.from('profiles').select('id, role, company_name, country_code, kyc_verified, created_at, avatar_url, is_banned').eq('id', id).maybeSingle(),
    supabase.from('products').select(CATALOG_PRODUCT_SELECT).eq('supplier_id', id).eq('status', 'live').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(48),
    supabase.rpc('supplier_follower_count', { p_supplier_id: id }),
    supabase.from('follows').select('following_id').eq('follower_id', user.id).eq('following_id', id).maybeSingle(),
    goldSupplierIds(supabase, [id]),
  ]);
  const supplier = supplierRes.data as null | {
    id: string; role: string; company_name: string; country_code: string; kyc_verified: boolean; created_at: string; avatar_url: string | null; is_banned: boolean | null;
  };
  if (!supplier || supplier.role !== 'supplier' || supplier.is_banned) notFound();

  const products = ((productsRes.data ?? []) as unknown as CatalogProductRow[]).map((r) => toTrialProductView(r, null, gold));
  // Before migration 030 the count / follow reads fail: show the page without them.
  const followsAvailable = !countRes.error;
  const followers = typeof countRes.data === 'number' ? countRes.data : 0;
  const since = new Date(supplier.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const back = profile.role === 'supplier' ? '/supplier' : '/dashboard/discover';

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div aria-hidden className="ambient-glow -top-10 left-1/4 -z-10 h-72 w-72 bg-blue-600/10" />
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>

        <section aria-labelledby="supplier-name" className="glass-card mt-4 flex flex-wrap items-center gap-5 p-6">
          <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-lg font-semibold text-snow shadow-[0_8px_24px_-10px_rgb(59_130_246/0.7)]">
            {supplier.avatar_url
              // eslint-disable-next-line @next/next/no-img-element -- the supplier's own avatar from the public avatars bucket
              ? <img src={supplier.avatar_url} alt="" width={64} height={64} className="h-full w-full object-cover" />
              : initials(supplier.company_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Supplier</p>
            <h1 id="supplier-name" className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-neutral-900">
              {supplier.company_name}
              {supplier.kyc_verified && <span className="pill tone-escrow text-[11px]"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> KYC verified</span>}
              {gold.has(supplier.id) && <GoldBadge />}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
              <span>{flag(supplier.country_code)} {countryName(supplier.country_code)}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> On SokoGlobal since {since}</span>
              <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" aria-hidden /> {products.length} live listing{products.length === 1 ? '' : 's'}</span>
              {followsAvailable && <span className="inline-flex items-center gap-1 tabular-nums"><Users className="h-3.5 w-3.5" aria-hidden /> {followerLabel(followers)}</span>}
            </p>
          </div>
          {followsAvailable && <FollowButton supplierId={supplier.id} supplierName={supplier.company_name} initialFollowing={!!followRes.data} />}
        </section>

        <section aria-labelledby="listings" className="mt-10">
          <h2 id="listings" className="text-xl font-semibold text-neutral-900">Trial Batches</h2>
          {products.length === 0 ? (
            <p className="glass-card mt-4 px-6 py-10 text-center text-sm text-neutral-600">
              No live listings right now.{followsAvailable ? ' Follow this supplier to see new ones on your dashboard.' : ''}
            </p>
          ) : (
            <div className="mt-6 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => <TrialBatchCard key={p.id} product={p} />)}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
