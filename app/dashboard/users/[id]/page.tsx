import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CalendarDays, PencilLine, Store, UserRound } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import { countryName, flag } from '@/lib/format';
import { initials } from '@/lib/admin-inbox';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';
import { goldSupplierIds } from '@/lib/pricing-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import TrialBatchCard from '@/components/dashboard/TrialBatchCard';
import FollowButton from '@/components/follow/FollowButton';
import GoldBadge from '@/components/supplier/GoldBadge';

export const metadata = { title: 'Profile · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface PublicProfile {
  id: string; role: 'importer' | 'supplier'; full_name: string; company_name: string; country_code: string; avatar_url: string | null;
  bio: string | null; kyc_verified: boolean; created_at: string; follower_count: number; following_count: number; live_listings: number;
}

/**
 * Public profile of any importer or supplier, for signed-in users (Sellsy layout): avatar, names, bio,
 * follower / following / listing counts, live listings and — on supplier profiles — the Follow button.
 * Everything comes from public_profile() (migration 031: safe fields only, banned and admin accounts excluded)
 * and the existing "products: read live" / "follows: read own" policies. Follows stay supplier-only (migration 030).
 */
export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/dashboard/users/${id}`);

  const res = await supabase.rpc('public_profile', { p_id: id });
  // Before migration 031 there is no public_profile(): supplier pages still work at their old address.
  if (res.error) redirect(`/dashboard/suppliers/${id}`);
  const p = (Array.isArray(res.data) ? res.data[0] : res.data) as PublicProfile | undefined;
  if (!p) notFound();

  const isSupplier = p.role === 'supplier';
  const isSelf = p.id === user.id;
  const [productsRes, followRes, gold] = isSupplier
    ? await Promise.all([
      supabase.from('products').select(CATALOG_PRODUCT_SELECT).eq('supplier_id', id).eq('status', 'live').is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(48),
      supabase.from('follows').select('following_id').eq('follower_id', user.id).eq('following_id', id).maybeSingle(),
      goldSupplierIds(supabase, [id]),
    ])
    : [null, null, new Set<string>()] as const;
  const products = ((productsRes?.data ?? []) as unknown as CatalogProductRow[]).map((r) => toTrialProductView(r, null, gold));
  const since = new Date(p.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const back = profile.role === 'supplier' ? '/supplier' : '/dashboard';
  const stats: [string, number][] = [
    ['Followers', p.follower_count], ['Following', p.following_count], ...(isSupplier ? [['Live listings', p.live_listings] as [string, number]] : []),
  ];

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-8">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Back</Link>

        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          {/* Identity */}
          <section aria-labelledby="profile-name" className="sx-card flex flex-wrap items-center gap-5 p-6 sm:p-8 lg:col-span-8">
            <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[#5a9895]/25 text-2xl font-semibold text-[#8fd3cc] ring-1 ring-snow/10">
              {p.avatar_url
                // eslint-disable-next-line @next/next/no-img-element -- the user's own avatar from the public avatars bucket
                ? <img src={p.avatar_url} alt="" width={80} height={80} className="h-full w-full object-cover" />
                : initials(p.company_name || p.full_name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="sx-pill sx-pill-muted">{isSupplier ? <><Store className="h-3 w-3" aria-hidden /> Supplier</> : <><UserRound className="h-3 w-3" aria-hidden /> Importer</>}</span>
                {p.kyc_verified && <span className="sx-pill sx-pill-mint"><BadgeCheck className="h-3 w-3" aria-hidden /> {isSupplier ? 'Verified supplier' : 'Verified business'}</span>}
                {gold.has(p.id) && <GoldBadge />}
              </div>
              <h1 id="profile-name" className="mt-3 truncate text-2xl font-semibold text-neutral-900 sm:text-3xl">{p.company_name || p.full_name}</h1>
              {p.company_name && p.full_name && <p className="mt-0.5 truncate text-sm text-neutral-600">{p.full_name}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
                <span>{flag(p.country_code)} {countryName(p.country_code)}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> Joined {since}</span>
              </p>
            </div>
            {isSelf
              ? <Link href="/dashboard/settings?tab=profile" className="btn-secondary px-4 py-2"><PencilLine className="h-4 w-4" aria-hidden /> Edit profile</Link>
              : isSupplier && <FollowButton supplierId={p.id} supplierName={p.company_name} initialFollowing={!!followRes?.data} />}
          </section>

          {/* Counts */}
          <section aria-label="Profile stats" className={`sx-card grid gap-4 p-6 lg:col-span-4 ${stats.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {stats.map(([label, n]) => (
              <div key={label}>
                <p className="text-xs text-neutral-500">{label}</p>
                <p className="mt-2 text-3xl font-normal tabular-nums text-neutral-900">{n.toLocaleString('en-US')}</p>
              </div>
            ))}
          </section>

          {/* Bio */}
          <section aria-labelledby="bio-title" className="sx-card p-6 sm:p-8 lg:col-span-12">
            <h2 id="bio-title" className="sx-card-title">About</h2>
            {p.bio
              ? <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-neutral-700">{p.bio}</p>
              : <p className="mt-3 text-sm text-neutral-500">{isSelf ? 'You haven’t written a bio yet. ' : 'No bio yet.'}
                  {isSelf && <Link href="/dashboard/settings?tab=profile" className="text-neutral-900 underline underline-offset-4">Add one</Link>}</p>}
          </section>
        </div>

        {isSupplier && (
          <section aria-labelledby="listings" className="mt-10">
            <h2 id="listings" className="text-xl font-semibold text-neutral-900">Active listings</h2>
            {products.length === 0 ? (
              <p className="sx-card mt-4 px-6 py-10 text-center text-sm text-neutral-500">
                No live listings right now.{!isSelf ? ' Follow this supplier to see new ones on your dashboard.' : ''}
              </p>
            ) : (
              <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {products.map((prod) => <TrialBatchCard key={prod.id} product={prod} />)}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
