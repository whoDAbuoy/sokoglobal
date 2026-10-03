import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { ImageIcon, Plus } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import type { ProductStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import SupportWidget from '@/components/dashboard/SupportWidget';

const STATUS_STYLE: Record<ProductStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20',
  live: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20',
  archived: 'bg-slate-100 text-slate-500',
};

export default async function SupplierHome() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const { data: products } = await supabase
    .from('products')
    .select('id, title, category, status, trial_goods_cents, trial_landed_cost_cents, product_media ( id )')
    .eq('supplier_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your catalogue</h1>
            <p className="mt-1 text-sm text-slate-500">Products go live after logistics quoting and photo review.</p>
          </div>
          <Link href="/supplier/products/new" className="btn-primary"><Plus className="h-4 w-4" /> New product</Link>
        </div>

        <div className="card mt-6 divide-y divide-slate-100">
          {(products ?? []).length === 0 && (
            <p className="px-6 py-12 text-center text-sm text-slate-500">No products yet. Create your first Trial Batch listing.</p>
          )}
          {(products ?? []).map((p) => (
            <Link key={p.id} href={`/supplier/products/${p.id}`} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50">
              <div>
                <p className="font-medium text-slate-900">{p.title}</p>
                <p className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                  <span className="capitalize">{p.category}</span>
                  <span className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" />{(p.product_media ?? []).length} media</span>
                  <span>Goods {formatUSD(p.trial_goods_cents)}</span>
                </p>
              </div>
              <span className={clsx('rounded-full px-2.5 py-1 text-xs font-medium capitalize', STATUS_STYLE[p.status as ProductStatus])}>
                {String(p.status).replace('_', ' ')}
              </span>
            </Link>
          ))}
        </div>
      </main>
      <SupportWidget />
    </>
  );
}
