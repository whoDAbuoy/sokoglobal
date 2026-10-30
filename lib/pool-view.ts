import type { EscrowStatus, ProductCategory, TrendPoolView } from '@/lib/types';

/** Trend Pool columns + the product's category, origin and photos (the dashboard strip and /dashboard/pools). */
export const POOL_SELECT = `id, product_id, title, description, destination_country, target_cents, pledged_cents, min_contribution_cents,
  freight_total_cents, member_count, max_members, deadline, status, created_at,
  product:products ( category, origin_country, product_media ( public_url, media_type, sort_order ) )`;

type MediaRow = { public_url: string; media_type: string; sort_order?: number | null };
type PoolRow = {
  id: string; title: string; description: string | null; destination_country: string; target_cents: number; pledged_cents: number;
  min_contribution_cents: number; freight_total_cents: number; member_count: number; max_members: number; deadline: string; status: string;
  created_at?: string | null; product: unknown;
};
export type PoolViewWithDate = TrendPoolView & { created_at: string | null };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** A pool row → the card's view, with the signed-in buyer's own pledge (if any). */
export function toPoolView(p: PoolRow, mine?: { contribution_cents: number; payment_status: EscrowStatus } | undefined): PoolViewWithDate {
  const product = one(p.product as { category: ProductCategory; origin_country: string; product_media: MediaRow[] } | null);
  const image = [...(product?.product_media ?? [])].filter((m) => m.media_type === 'image')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.public_url ?? null;
  return {
    id: p.id, title: p.title, description: p.description, destination_country: p.destination_country,
    target_cents: p.target_cents, pledged_cents: p.pledged_cents, min_contribution_cents: p.min_contribution_cents,
    freight_total_cents: p.freight_total_cents, member_count: p.member_count, max_members: p.max_members,
    deadline: p.deadline, status: p.status, created_at: p.created_at ?? null,
    category: product?.category ?? 'beauty', origin_country: product?.origin_country ?? 'US',
    image_url: image, my_contribution_cents: mine?.contribution_cents ?? 0, my_payment_status: mine?.payment_status ?? null,
  };
}
