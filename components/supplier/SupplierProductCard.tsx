import Link from 'next/link';
import clsx from 'clsx';
import { ImageIcon, Play, Video } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import type { MediaType, ProductCategory, ProductStatus } from '@/lib/types';
import ProductVisual from '@/components/dashboard/ProductVisual';
import { STAGE_META, type OrderCounts, type OrderStage } from './orderStages';

export interface SupplierProductMedia {
  id: string;
  media_type: MediaType;
  public_url: string | null;
  sort_order: number | null;
}

export interface SupplierProduct {
  id: string;
  title: string;
  category: ProductCategory;
  status: ProductStatus;
  trial_goods_cents: number;
  trial_landed_cost_cents: number | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  product_media: SupplierProductMedia[] | null;
}

const STATUS_PILL: Record<ProductStatus, { label: string; className: string }> = {
  live: { label: 'Live', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  pending_review: { label: 'Pending review', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  draft: { label: 'Draft', className: 'border-neutral-200 bg-white text-neutral-700' },
  archived: { label: 'Archived', className: 'border-neutral-200 bg-neutral-100 text-neutral-500' },
};

const BAR_ORDER: OrderStage[] = ['completed', 'escrow', 'awaiting', 'closed'];

export default function SupplierProductCard({ product, orders }: { product: SupplierProduct; orders: OrderCounts }) {
  const media = [...(product.product_media ?? [])]
    .filter((m) => m.public_url)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const images = media.filter((m) => m.media_type === 'image');
  const videos = media.filter((m) => m.media_type === 'swatch_video');
  const firstImage = images[0]?.public_url ?? null;
  const firstVideo = videos[0]?.public_url ?? null;

  const removed = Boolean(product.deleted_at);
  const pill = removed
    ? { label: 'Removed', className: 'border-red-200 bg-red-50 text-red-700' }
    : STATUS_PILL[product.status] ?? STATUS_PILL.draft;

  return (
    <Link href={`/supplier/products/${product.id}`} className="group flex flex-col">
      <div className={clsx('relative overflow-hidden rounded-lg', removed && 'opacity-60')}>
        {firstImage || !firstVideo ? (
          <ProductVisual src={firstImage} alt={product.title} category={product.category} className="aspect-[4/3]" />
        ) : (
          <div className="relative aspect-[4/3] bg-neutral-900">
            <video
              src={`${firstVideo}#t=0.1`}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
              aria-label={`${product.title} video preview`}
            />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-neutral-900 shadow-sm transition-transform group-hover:scale-105">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
            </span>
          </div>
        )}

        <span className={clsx('pill absolute left-3 top-3', pill.className)}>{pill.label}</span>
        {firstVideo && (
          <span className="pill absolute right-3 top-3 gap-1 border-transparent bg-white/95 text-neutral-900">
            <Video className="h-3 w-3" /> Video
          </span>
        )}
        {media.length > 0 && (
          <span className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium tabular-nums text-white">
            <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" />{images.length}</span>
            {videos.length > 0 && <span className="flex items-center gap-1"><Video className="h-3 w-3" />{videos.length}</span>}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col pt-4">
        <p className="text-xs capitalize text-neutral-500">{product.category}</p>
        <h3 className="mt-0.5 text-base font-medium leading-snug text-neutral-900 group-hover:underline">{product.title}</h3>
        {removed && (
          <p className="mt-1 text-xs text-red-700">Removed by SokoGlobal: {product.deletion_reason}</p>
        )}

        <dl className="mt-3 grid grid-cols-2 divide-x divide-neutral-200 border-y border-neutral-200">
          <div className="py-2.5 pr-3">
            <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Goods value</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">{formatUSD(product.trial_goods_cents)}</dd>
          </div>
          <div className="py-2.5 pl-3">
            <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Landed cost</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
              {product.trial_landed_cost_cents != null && product.trial_landed_cost_cents > product.trial_goods_cents
                ? formatUSD(product.trial_landed_cost_cents)
                : <span className="font-normal text-neutral-400">Quote pending</span>}
            </dd>
          </div>
        </dl>

        <OrderProgress orders={orders} />
      </div>
    </Link>
  );
}

function OrderProgress({ orders }: { orders: OrderCounts }) {
  if (orders.total === 0) {
    return <p className="mt-3 text-xs text-neutral-400">No orders yet</p>;
  }
  const chips: OrderStage[] = ['escrow', 'completed'];   // unpaid orders are not visible to suppliers
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium tabular-nums text-neutral-900">{orders.total} order{orders.total === 1 ? '' : 's'}</span>
        {orders.escrowCents > 0 && <span className="tabular-nums text-neutral-500">{formatUSD(orders.escrowCents)} in escrow</span>}
      </div>
      <div
        className="mt-2 flex h-1 gap-px overflow-hidden rounded-full bg-neutral-200"
        role="img"
        aria-label={BAR_ORDER.filter((s) => orders[s] > 0).map((s) => `${orders[s]} ${STAGE_META[s].label}`).join(', ')}
      >
        {BAR_ORDER.map((s) =>
          orders[s] > 0 ? (
            <div key={s} className={clsx('h-full', STAGE_META[s].bar)} style={{ width: `${(orders[s] / orders.total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        {chips.map((s) => (
          <span key={s} className="flex items-center gap-1 tabular-nums">
            <span className={clsx('h-1.5 w-1.5 rounded-full', STAGE_META[s].dot)} aria-hidden />
            {orders[s]} {STAGE_META[s].label}
          </span>
        ))}
        {orders.closed > 0 && (
          <span className="flex items-center gap-1 tabular-nums">
            <span className={clsx('h-1.5 w-1.5 rounded-full', STAGE_META.closed.dot)} aria-hidden />
            {orders.closed} {STAGE_META.closed.label}
          </span>
        )}
      </p>
    </div>
  );
}
