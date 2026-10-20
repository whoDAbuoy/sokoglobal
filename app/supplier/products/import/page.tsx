import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { IMPORT_MAX_ROWS } from '@/lib/catalog-import';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ImportWorkspace from './ImportWorkspace';

export const metadata = { title: 'Bulk import · SokoGlobal' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/products/import');
  if (profile.role !== 'supplier') redirect('/dashboard');
  const { data: categories } = await supabase.from('categories').select('slug, name, parent_id, id').eq('is_active', true).order('sort_order');
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));
  const leaves = (categories ?? []).filter((c) => !(categories ?? []).some((x) => x.parent_id === c.id))
    .map((c) => ({ slug: c.slug, label: [byId.get(c.parent_id ?? '')?.name, c.name].filter(Boolean).join(' › ') }));

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <h1 className="mt-4 text-3xl font-semibold text-neutral-900">Bulk import listings</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Upload a CSV or Excel sheet with up to {IMPORT_MAX_ROWS} products: one row per SKU, with optional volume price tiers and category attributes.
          Every row becomes a draft; add photos to each before submitting it for review.
        </p>
        <ImportWorkspace categories={leaves} />
      </main>
    </>
  );
}
