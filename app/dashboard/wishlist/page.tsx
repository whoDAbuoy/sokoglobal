import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import WishlistView from '@/components/wishlist/WishlistView';

export const metadata = { title: 'Wishlist · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Saved products. The list itself lives in the browser (per user); product details are read live. */
export default async function WishlistPage() {
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/wishlist');
  if (profile.role === 'supplier') redirect('/supplier');

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Wishlist</h1>
        <WishlistView />
      </main>
    </>
  );
}
