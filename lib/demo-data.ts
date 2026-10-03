import type { OrderView, TrendPoolView, TrialProductView } from '@/lib/types';

/**
 * Shown on the dashboard only when the database has no live pools/products yet
 * (fresh project). Run supabase/seed.sql to replace with real rows.
 */
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export const DEMO_POOLS: TrendPoolView[] = [
  {
    id: 'demo-pool-1', title: 'Korean Skincare Batch — Lagos', category: 'beauty',
    description: 'Full pallet of K-beauty best-sellers, consolidated air freight to Lagos.',
    origin_country: 'KR', destination_country: 'NG', target_cents: 1_000_000, pledged_cents: 800_000,
    min_contribution_cents: 25_000, freight_total_cents: 180_000, member_count: 14, max_members: 25,
    deadline: inDays(6), status: 'open', image_url: null, my_contribution_cents: 0, is_demo: true,
  },
  {
    id: 'demo-pool-2', title: 'US Denim Wholesale Pool — Accra', category: 'clothing',
    description: 'Mixed size runs; volumetric freight split by contribution.',
    origin_country: 'US', destination_country: 'GH', target_cents: 1_500_000, pledged_cents: 1_335_000,
    min_contribution_cents: 30_000, freight_total_cents: 260_000, member_count: 21, max_members: 30,
    deadline: inDays(3), status: 'open', image_url: null, my_contribution_cents: 0, is_demo: true,
  },
  {
    id: 'demo-pool-3', title: 'Deep-Tone Lip Colour Pool — Nairobi', category: 'beauty',
    description: 'French lip colour in 12 shades, shared air freight to JKIA.',
    origin_country: 'FR', destination_country: 'KE', target_cents: 600_000, pledged_cents: 312_000,
    min_contribution_cents: 15_000, freight_total_cents: 96_000, member_count: 9, max_members: 20,
    deadline: inDays(11), status: 'open', image_url: null, my_contribution_cents: 0, is_demo: true,
  },
];

export const DEMO_PRODUCTS: TrialProductView[] = [
  {
    id: 'demo-prod-1', title: 'Hydrating Snail Mucin Essence 100ml', brand: 'Seoul Lab', category: 'beauty',
    origin_country: 'KR', supplier_name: 'Seoul Lab Co.', supplier_verified: true, trial_units: 48,
    unit_price_cents: 680, goods_cents: 32_640, freight_cents: 11_200, customs_cents: 6_700, landed_cost_cents: 50_540,
    lead_time_days: 9, image_url: null, has_swatch_video: true, is_demo: true,
  },
  {
    id: 'demo-prod-2', title: 'Premium Stretch Denim — Mixed Sizes', brand: 'Atlantic Denim Co.', category: 'clothing',
    origin_country: 'US', supplier_name: 'Atlantic Denim Co.', supplier_verified: true, trial_units: 30,
    unit_price_cents: 1_450, goods_cents: 43_500, freight_cents: 9_800, customs_cents: 7_200, landed_cost_cents: 60_500,
    lead_time_days: 14, image_url: null, has_swatch_video: false, is_demo: true,
  },
  {
    id: 'demo-prod-3', title: 'Matte Lip Colour — Deep Tones Collection', brand: 'Maison Rouge', category: 'beauty',
    origin_country: 'FR', supplier_name: 'Maison Rouge SAS', supplier_verified: true, trial_units: 96,
    unit_price_cents: 420, goods_cents: 40_320, freight_cents: 6_400, customs_cents: 5_280, landed_cost_cents: 52_000,
    lead_time_days: 12, image_url: null, has_swatch_video: true, is_demo: true,
  },
];

export const DEMO_ORDERS: OrderView[] = [
  { id: 'demo-order-1', order_type: 'trial', escrow_status: 'in_transit', total_cents: 52_000,
    created_at: inDays(-4), product_title: 'Matte Lip Colour — Deep Tones Collection' },
];
