/** Supabase product row → TrialProductView (shared by catalogue pages). Pure. */
import type { GalleryMedia, ProductCategory, TrialProductView } from './types';
import { parsePriceTiers } from './catalog';

export type MediaRow = { public_url: string; media_type: 'image' | 'swatch_video'; sort_order?: number };
const sorted = (media: MediaRow[] | null | undefined) => [...(media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
export const allImages = (media: MediaRow[] | null | undefined) => sorted(media).filter((m) => m.media_type === 'image').map((m) => m.public_url);
export const galleryMedia = (media: MediaRow[] | null | undefined): GalleryMedia[] => [
  ...sorted(media).filter((m) => m.media_type === 'image').map((m) => ({ type: 'image' as const, url: m.public_url })),
  ...sorted(media).filter((m) => m.media_type === 'swatch_video').map((m) => ({ type: 'video' as const, url: m.public_url })),
];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Columns for a CatalogProductRow (catalogue, supplier profile, follow feed). */
export const CATALOG_PRODUCT_SELECT = `id, supplier_id, title, brand, category, origin_country, trial_units, unit_price_cents, trial_goods_cents, trial_freight_cents,
  trial_customs_cents, trial_landed_cost_cents, lead_time_days, created_at, attributes, category_id, is_featured, moq, unit_of_measure, price_tiers,
  supplier:profiles!products_supplier_id_fkey ( company_name, kyc_verified ), product_media ( public_url, media_type, sort_order )`;

export interface CatalogProductRow {
  id: string; title: string; brand: string | null; category: ProductCategory; origin_country: string;
  trial_units: number; unit_price_cents: number; trial_goods_cents: number; trial_freight_cents: number; trial_customs_cents: number;
  trial_landed_cost_cents: number; lead_time_days: number | null; created_at: string;
  attributes: Record<string, unknown> | null; category_id: string | null; is_featured: boolean | null;
  moq: number | null; unit_of_measure: string | null; price_tiers: unknown;
  supplier: unknown; product_media: unknown;
  supplier_id?: string;
}

export function toTrialProductView(p: CatalogProductRow, categoryName: string | null = null, goldSuppliers?: ReadonlySet<string>): TrialProductView {
  const supplier = one(p.supplier as { company_name: string; kyc_verified: boolean } | null);
  const media = (p.product_media ?? []) as MediaRow[];
  const images = allImages(media);
  return {
    id: p.id, title: p.title, brand: p.brand, category: p.category, origin_country: p.origin_country,
    supplier_id: p.supplier_id, supplier_name: supplier?.company_name ?? 'Verified supplier', supplier_verified: !!supplier?.kyc_verified,
    supplier_gold: !!p.supplier_id && !!goldSuppliers?.has(p.supplier_id),
    trial_units: p.trial_units, unit_price_cents: p.unit_price_cents, goods_cents: p.trial_goods_cents,
    freight_cents: p.trial_freight_cents, customs_cents: p.trial_customs_cents, landed_cost_cents: p.trial_landed_cost_cents,
    lead_time_days: p.lead_time_days, image_url: images[0] ?? null, image_urls: images, media: galleryMedia(media),
    has_swatch_video: media.some((m) => m.media_type === 'swatch_video'),
    is_featured: !!p.is_featured, category_name: categoryName, moq: p.moq, unit_of_measure: p.unit_of_measure,
    price_tiers: parsePriceTiers(p.price_tiers),
  };
}
