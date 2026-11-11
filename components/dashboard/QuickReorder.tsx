'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { FileQuestion, RotateCcw, ShoppingBag } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { reorderLines, type ReorderLine, type ReorderSource } from '@/lib/reorder';
import ProductVisual from '@/components/dashboard/ProductVisual';
import Price from '@/components/currency/Price';

export interface QuotedReorder { order_id: string; product_id: string; title: string; quantity: number; completed_at: string | null }

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * Quick reorder matrix: one row per listing the buyer has completed an order
 * for. "Reorder" fills the cart with the same number of Trial Batches at
 * today's price (checkout re-prices in Postgres anyway); quoted orders link
 * to a pre-filled request for a fresh quote instead.
 */
export default function QuickReorder({ sources, quoted }: { sources: ReorderSource[]; quoted: QuotedReorder[] }) {
  const cart = useCart();
  const { lines, unavailable } = reorderLines(sources);
  const completedAt = new Map(sources.map((s) => [s.order_id, s.completed_at]));
  if (!lines.length && !quoted.length && !unavailable.length) return null;

  function put(batch: ReorderLine[]) {
    const r = cart.reorder(batch.map(({ fromOrderId: _from, ...item }) => item));
    if (r.skipped) toast.warning(`Your cart is full — ${r.skipped} product${r.skipped === 1 ? ' was' : 's were'} not added.`);
    else toast.success(batch.length === 1 ? `${batch[0].title} is in your cart` : `${batch.length} products are in your cart`,
      { description: 'Same batch quantities as last time. Prices are confirmed at checkout.' });
    cart.setOpen(true);
  }

  return (
    <section id="reorder" aria-labelledby="reorder-title" data-tour="quick-reorder" className="mt-10 scroll-mt-32">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="reorder-title" className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><RotateCcw className="h-4 w-4" aria-hidden /> Quick reorder</h2>
          <p className="mt-1 text-sm text-neutral-500">Restock what sold — same products, same batch quantities, today&apos;s prices.</p>
        </div>
        {lines.length > 1 && (
          <button type="button" onClick={() => put(lines)} className="btn-primary px-3.5 py-2">
            <ShoppingBag className="h-4 w-4" aria-hidden /> Reorder all ({lines.length})
          </button>
        )}
      </div>

      <div className="card mt-4 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="hidden border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 sm:table-header-group">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Last completed</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Batches</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Today</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {lines.map((l) => (
              <tr key={l.productId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:table-row sm:p-0">
                <td className="flex min-w-0 flex-1 items-center gap-3 sm:px-4 sm:py-3">
                  <ProductVisual src={l.imageUrl} alt="" category={l.category} className="h-10 w-10 shrink-0 rounded-md" />
                  <span className="min-w-0">
                    <span className="line-clamp-1 font-medium text-neutral-900">{l.title}</span>
                    <span className="block text-xs text-neutral-500">{l.supplierName}</span>
                  </span>
                </td>
                <td className="text-xs text-neutral-500 sm:px-4 sm:py-3 sm:text-sm">{date(completedAt.get(l.fromOrderId) ?? null)}</td>
                <td className="tabular-nums text-neutral-700 sm:px-4 sm:py-3 sm:text-right">{l.quantity} <span className="sm:hidden">batch{l.quantity === 1 ? '' : 'es'}</span></td>
                <td className="tabular-nums font-medium text-neutral-900 sm:px-4 sm:py-3 sm:text-right"><Price cents={l.landedCostCents * l.quantity} /></td>
                <td className="ml-auto sm:px-4 sm:py-3 sm:text-right">
                  <button type="button" onClick={() => put([l])} className="btn-secondary whitespace-nowrap px-3 py-1.5 text-sm">
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reorder bulk batch
                  </button>
                </td>
              </tr>
            ))}
            {quoted.map((q) => (
              <tr key={q.order_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:table-row sm:p-0">
                <td className="min-w-0 flex-1 sm:px-4 sm:py-3">
                  <span className="line-clamp-1 font-medium text-neutral-900">{q.title}</span>
                  <span className="block text-xs text-neutral-500">Quoted order · {q.quantity.toLocaleString('en-US')} units</span>
                </td>
                <td className="text-xs text-neutral-500 sm:px-4 sm:py-3 sm:text-sm">{date(q.completed_at)}</td>
                <td className="hidden sm:table-cell" />
                <td className="hidden sm:table-cell" />
                <td className="ml-auto sm:px-4 sm:py-3 sm:text-right">
                  <Link href={`/dashboard/rfqs?product=${q.product_id}&quantity=${q.quantity}`} className="btn-secondary whitespace-nowrap px-3 py-1.5 text-sm">
                    <FileQuestion className="h-3.5 w-3.5" aria-hidden /> Request new quote
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {unavailable.length > 0 && (
          <p className="border-t border-neutral-200 px-4 py-2.5 text-xs text-neutral-500">
            {unavailable.length} past product{unavailable.length === 1 ? ' is' : 's are'} no longer listed and can&apos;t be reordered.
          </p>
        )}
      </div>
    </section>
  );
}
