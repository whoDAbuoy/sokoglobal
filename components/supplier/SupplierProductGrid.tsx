'use client';

import { useOptimistic } from 'react';
import SupplierProductCard, { type SupplierProduct } from './SupplierProductCard';
import DeleteDraftButton from './DeleteDraftButton';
import { emptyCounts, type OrderCounts } from './orderStages';

/** Supplier catalogue grid. Drafts get a Delete action; a deleted card disappears at once (useOptimistic). */
export default function SupplierProductGrid({ products, orders }: { products: SupplierProduct[]; orders: Record<string, OrderCounts> }) {
  const [shown, hide] = useOptimistic(products, (list, id: string) => list.filter((p) => p.id !== id));
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {shown.map((p) => {
        const counts = orders[p.id] ?? emptyCounts();
        const deletable = p.status === 'draft' && !p.deleted_at && counts.total === 0;
        return (
          <div key={p.id} className="relative">
            <SupplierProductCard product={p} orders={counts} />
            {deletable && (
              <DeleteDraftButton productId={p.id} title={p.title} onOptimisticRemove={() => hide(p.id)}
                className="absolute bottom-3 right-4" />
            )}
          </div>
        );
      })}
    </div>
  );
}
