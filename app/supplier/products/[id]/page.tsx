import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, MessageSquareWarning } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import type { ProductCategory, ProductMedia, ProductStatus } from '@/lib/types';
import ProductMediaManager from './ProductMediaManager';

export default async function ProductMediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=/supplier/products/${id}`);
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data: product } = await supabase
    .from('products')
    .select('id, title, category, status, supplier_id, review_notes, product_media ( id, product_id, media_type, public_url, storage_path, width, height, created_at )')
    .eq('id', id)
    .maybeSingle();
  if (!product || product.supplier_id !== user.id) notFound();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/supplier" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Catalogue</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{product.title}</h1>
      <p className="mt-1 text-sm text-slate-500">Step 2 of 2 — visual proof</p>
      {product.status === 'draft' && product.review_notes && (
        <div className="mt-4 flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-medium">Changes requested by our review team</p><p className="mt-1 whitespace-pre-line">{product.review_notes}</p></div>
        </div>
      )}
      <div className="mt-6">
        <ProductMediaManager
          productId={product.id}
          category={product.category as ProductCategory}
          status={product.status as ProductStatus}
          initialMedia={(product.product_media ?? []) as ProductMedia[]}
        />
      </div>
    </main>
  );
}
