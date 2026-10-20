'use client';

import { useOptimistic } from 'react';
import clsx from 'clsx';
import DeleteProductButton from '@/components/admin/DeleteProductButton';
import ProductStateMenu from '@/components/admin/ProductStateMenu';
import { flag, formatUSD } from '@/lib/format';
import type { ProductStatus } from '@/lib/types';

export interface AdminProductRow {
  id: string;
  title: string;
  brand: string | null;
  status: ProductStatus;
  trial_landed_cost_cents: number;
  updated_at: string;
  deleted_at: string | null;
  deletion_reason: string | null;
  supplier: { company_name: string; country_code: string } | null;
  order_count: number;
  pool_count: number;
  /** Migration 015 (absent before it runs). */
  is_featured?: boolean;
  category_name?: string | null;
}

const STATUS_STYLE: Record<ProductStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_review: 'bg-amber-50 text-amber-800',
  live: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-slate-100 text-slate-500',
};

/** Rows vanish as soon as Delete is confirmed; they come back if the action fails. */
export default function ProductTable({ rows, canOverride = false }: { rows: AdminProductRow[]; canOverride?: boolean }) {
  const [visible, hide] = useOptimistic(rows, (state, id: string) => state.filter((r) => r.id !== id));

  return (
    <div className="card mt-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">Product</th>
            <th scope="col" className="px-5 py-3 font-semibold">Supplier</th>
            <th scope="col" className="px-5 py-3 font-semibold">Status</th>
            <th scope="col" className="px-5 py-3 font-semibold">History</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Landed</th>
            <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visible.length === 0 && (
            <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No products match.</td></tr>
          )}
          {visible.map((p) => {
            const hasHistory = p.order_count > 0 || p.pool_count > 0;
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-900">{p.title}</p>
                  <p className="text-xs text-slate-500">{p.category_name ? `${p.category_name} · ` : ''}{p.brand ?? '—'} · #{p.id.slice(0, 8).toUpperCase()}</p>
                  {p.deleted_at && (
                    <p className="mt-1 max-w-md text-xs text-red-700">
                      Removed {new Date(p.deleted_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}: {p.deletion_reason}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-700">
                  {p.supplier ? <>{flag(p.supplier.country_code)} {p.supplier.company_name}</> : '—'}
                </td>
                <td className="px-5 py-3">
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLE[p.status])}>
                    {p.deleted_at ? 'removed' : p.status === 'archived' ? 'delisted' : p.status.replace('_', ' ')}
                  </span>
                  {p.is_featured && <span className="ml-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">Featured</span>}
                </td>
                <td className="px-5 py-3 text-xs text-slate-600">
                  {hasHistory ? `${p.order_count} order(s) · ${p.pool_count} pool(s)` : 'None'}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatUSD(p.trial_landed_cost_cents, true)}</td>
                <td className="px-5 py-3 text-right">
                  {!p.deleted_at && canOverride && <ProductStateMenu productId={p.id} title={p.title} status={p.status} featured={!!p.is_featured} />}
                  {!p.deleted_at && (
                    <DeleteProductButton productId={p.id} title={p.title} hasHistory={hasHistory}
                      onOptimisticRemove={() => hide(p.id)} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
