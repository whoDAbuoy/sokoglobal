import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Compass, UserCheck } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';
import { goldSupplierIds } from '@/lib/pricing-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import FollowingDirectory, { type FollowedSupplier } from '@/components/follow/FollowingDirectory';

export const metadata = { title: 'Suppliers you follow · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface ProfileRow { id: string; company_name: string; full_name: string | null; country_code: string; kyc_verified: boolean; avatar_url: string | null; created_at: string }
type Num = number | null;

/**
 * Every supplier the buyer follows, with their profiles. All reads run as the buyer under RLS:
 * "follows: read own", "profiles: read suppliers", "products: read live", plus the counting functions
 * public_profile() (migration 031), supplier_rating() / can_rate_supplier() and own rows of
 * supplier_ratings (032). Each newer piece is optional: before its migration the page simply omits it.
 */
export default async function FollowingPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/following');

  const followsRes = await supabase.from('follows').select('following_id').eq('follower_id', user.id)
    .order('created_at', { ascending: false }).limit(200);
  const ids = followsRes.error ? [] : (followsRes.data ?? []).map((f) => f.following_id as string);

  let suppliers: FollowedSupplier[] = [];
  if (ids.length) {
    const [profilesRes, productsRes, myRatingsRes, gold] = await Promise.all([
      supabase.from('profiles').select('id, company_name, full_name, country_code, kyc_verified, avatar_url, created_at').in('id', ids),
      supabase.from('products').select(CATALOG_PRODUCT_SELECT).in('supplier_id', ids).eq('status', 'live').is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(300),
      supabase.from('supplier_ratings').select('supplier_id, stars').in('supplier_id', ids),
      goldSupplierIds(supabase, ids),
    ]);
    const rows = new Map(((profilesRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
    const listings = ((productsRes.data ?? []) as unknown as CatalogProductRow[]).map((r) => toTrialProductView(r, null, gold));
    const ratingsReady = !myRatingsRes.error;
    const myStars = new Map((myRatingsRes.data ?? []).map((r) => [r.supplier_id as string, r.stars as number]));

    const perSupplier = await Promise.all(ids.filter((id) => rows.has(id)).map(async (id) => {
      const [pub, agg, can, followerCount] = await Promise.all([
        supabase.rpc('public_profile', { p_id: id }),
        ratingsReady ? supabase.rpc('supplier_rating', { p_supplier_id: id }) : Promise.resolve(null),
        ratingsReady ? supabase.rpc('can_rate_supplier', { p_supplier_id: id }) : Promise.resolve(null),
        supabase.rpc('supplier_follower_count', { p_supplier_id: id }),
      ]);
      const p = (Array.isArray(pub.data) ? pub.data[0] : pub.data) as { bio: string | null; follower_count: number; following_count: number; live_listings: number } | undefined;
      const a = (agg && !agg.error ? (Array.isArray(agg.data) ? agg.data[0] : agg.data) : null) as { average: Num | string; ratings: number } | null;
      return { id, p: pub.error ? null : p ?? null, a, can: can && !can.error ? !!can.data : false, followers: typeof followerCount.data === 'number' ? followerCount.data : null };
    }));

    suppliers = perSupplier.map(({ id, p, a, can, followers }) => {
      const row = rows.get(id)!;
      const own = listings.filter((l) => l.supplier_id === id);
      return {
        id, name: row.company_name, personName: row.full_name || null, country: row.country_code, verified: row.kyc_verified, gold: gold.has(id),
        avatarUrl: row.avatar_url, bio: p?.bio ?? null,
        since: new Date(row.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        followers: p?.follower_count ?? followers, following: p?.following_count ?? null,
        liveListings: p?.live_listings ?? own.length,
        rating: ratingsReady ? { average: a?.average === null || a?.average === undefined ? null : Number(a.average), count: a?.ratings ?? 0 } : null,
        canRate: can, myStars: myStars.get(id) ?? null,
        listings: own.slice(0, 6).map((l) => ({ id: l.id, title: l.title, image: l.image_url, landedCents: l.landed_cost_cents })),
      };
    });
  }

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
          <div>
            <p className="eyebrow">Network</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Suppliers you follow</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {followsRes.error ? 'Following suppliers isn’t switched on yet.'
                : `${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}. Open a profile for ratings, listings and more.`}
            </p>
          </div>
          <Link href="/dashboard/discover" className="btn-secondary px-4 py-2"><Compass className="h-4 w-4" aria-hidden /> Discover more suppliers</Link>
        </div>

        <div className="mt-8">
          {suppliers.length > 0 ? (
            <FollowingDirectory suppliers={suppliers} />
          ) : (
            <div className="sx-card px-6 py-14 text-center">
              <UserCheck className="mx-auto h-8 w-8 text-[#8fd3cc]" aria-hidden />
              <p className="mt-3 font-medium text-neutral-900">You’re not following any suppliers yet</p>
              <p className="mt-1 text-sm text-neutral-600">Tap Follow next to a supplier’s name on any Trial Batch, and they’ll appear here.</p>
              <Link href="/dashboard/discover" className="btn-primary mt-5 inline-flex px-4 py-2">Browse the catalogue</Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
