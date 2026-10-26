import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { ProductCategory } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import DraftsList, { type DraftItem } from '@/components/supplier/DraftsList';
import { PageHead } from '@/components/supplier/sellsy/ui';

export const metadata = { title: 'Drafts · SokoGlobal' };
export const dynamic = 'force-dynamic';

type Row = {
  id: string; title: string; category: ProductCategory; trial_goods_cents: number; trial_units: number; updated_at: string;
  review_notes: string | null; product_media: { media_type: string; public_url: string | null; sort_order: number | null }[] | null;
};

/**
 * Every draft listing in one place (started, imported, or sent back by a reviewer), with edit and
 * delete. Deleting is checked again in Postgres (delete_supplier_draft, migration 027): only clean
 * drafts go — never a listing with orders, Trend Pools or quotes.
 */
export default async function SupplierDraftsPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/drafts');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data, error } = await supabase.from('products')
    .select('id, title, category, trial_goods_cents, trial_units, updated_at, review_notes, product_media ( media_type, public_url, sort_order )')
    .eq('supplier_id', user.id).eq('status', 'draft').is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load your drafts: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];

  // Drafts an admin sent back may have orders or quotes; say why those stay instead of offering Delete.
  const blocks = await Promise.all(rows.map(async (r) => {
    const { data: block, error: blockError } = await supabase.rpc('supplier_draft_delete_block', { p_product_id: r.id });
    return blockError ? null : (block as string | null);
  }));

  const drafts: DraftItem[] = rows.map((r, i) => {
    const images = [...(r.product_media ?? [])].filter((m) => m.media_type === 'image' && m.public_url)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return {
      id: r.id, title: r.title, category: r.category, trial_goods_cents: r.trial_goods_cents,
      updated_at: r.updated_at, review_notes: r.review_notes, image_url: images[0]?.public_url ?? null, photo_count: images.length,
      delete_block: blocks[i],
    };
  });

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <PageHead eyebrow="Trial Batches" title={<>Drafts {drafts.length > 0 && <span className="sx-pill sx-pill-muted text-sm">{drafts.length}</span>}</>}
          actions={<Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden /> New product</Link>}>
          Listings that aren&apos;t submitted yet. Finish one and submit it for logistics quoting and photo review, or delete the ones you no longer need.
        </PageHead>
        <DraftsList drafts={drafts} />
      </main>
    </>
  );
}
