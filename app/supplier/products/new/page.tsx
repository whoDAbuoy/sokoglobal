import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { CategoryRow } from '@/lib/catalog';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import NewListingForm from './NewListingForm';
import LegacyListingForm from './LegacyListingForm';

export const metadata = { title: 'New listing · SokoGlobal' };
export const dynamic = 'force-dynamic';

/** New listing for any commodity. Before migration 015 (no categories table) the original beauty / clothing form is shown. */
export default async function NewProductPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/products/new');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data: categories, error } = await supabase.from('categories')
    .select('id, parent_id, slug, name, description, icon, sort_order, is_active, attribute_schema, legacy_category, requires_compliance');
  if (error || !categories?.length) return <LegacyListingForm />;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-neutral-900">New listing</h1>
            <p className="mt-1 text-sm text-neutral-600">Step 1 of 2: details. Next you&apos;ll upload real photos of the goods.</p>
          </div>
          <Link href="/supplier/products/import" className="btn-secondary px-3 py-2 text-sm"><FileSpreadsheet className="h-4 w-4" aria-hidden /> Bulk import (CSV / Excel)</Link>
        </div>
        <NewListingForm categories={categories as CategoryRow[]} supplierId={user.id} defaultOrigin={profile.country_code} />
      </main>
    </>
  );
}
