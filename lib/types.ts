export type UserRole = 'supplier' | 'importer' | 'admin' | 'super_admin';
/** Legacy bucket kept in sync from the product's category (migration 015). */
export type ProductCategory = 'beauty' | 'clothing' | 'general';
/** 'super' / 'admin' come from the role; 'delegated' from a live delegated_admin_grants row (migration 014). */
export type AdminLevel = 'super' | 'admin' | 'delegated';
export interface AdminAccess { level: AdminLevel; expires_at?: string | null; grant_id?: string | null }
export type ProductStatus = 'draft' | 'pending_review' | 'live' | 'archived';
export type MediaType = 'image' | 'swatch_video';
export type OrderType = 'trial' | 'pool' | 'standard';

export type EscrowStatus =
  | 'pending_payment'
  /** Milestone escrow: 30% deposit held, 70% balance due once dispatched (migration 021). */
  | 'deposit_paid'
  | 'funded'
  | 'in_transit'
  | 'customs_cleared'
  | 'delivered_pending_verification'
  | 'released'
  | 'disputed'
  | 'refunded'
  | 'cancelled';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  company_name: string;
  country_code: string;
  kyc_verified: boolean;
  /** Set by admins (migration 012); absent before the migration runs. */
  is_banned?: boolean;
  /** Resolved server-side by getSessionProfile() (my_admin_access RPC). */
  admin_access?: AdminAccess | null;
  /** Migration 016. */
  avatar_url?: string | null;
  two_factor_enabled?: boolean;
  /** Migration 017: platform KYC ('unsubmitted' | 'pending' | 'approved' | 'rejected'). */
  kyc_status?: 'unsubmitted' | 'pending' | 'approved' | 'rejected';
}

export interface ProductMedia {
  id: string;
  product_id: string;
  media_type: MediaType;
  public_url: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

/** Return value of admin_remove_product() (migration 006). */
export interface ProductRemovalResult {
  /** 'deleted' = row + media gone for good; 'archived' = soft-deleted because orders/pools reference it. */
  mode: 'deleted' | 'archived';
  storage_paths: string[];
  cancelled_pools: number;
  cancelled_orders: number;
  open_orders: number;
}

/**
 * One gallery slide. Video URLs may be direct files (.mp4/.webm/.mov), HLS
 * (.m3u8) or YouTube/Vimeo links — see lib/video.ts.
 */
export interface GalleryMedia {
  type: 'image' | 'video';
  url: string;
  poster?: string | null;
}

/** Shape rendered by the Trial Batch card on the buyer dashboard. */
export interface TrialProductView {
  id: string;
  title: string;
  brand: string | null;
  category: ProductCategory;
  origin_country: string;
  supplier_name: string;
  supplier_verified: boolean;
  /** Active Gold Supplier membership (migration 026) — a paid badge, separate from KYC. */
  supplier_gold?: boolean;
  trial_units: number;
  unit_price_cents: number;
  goods_cents: number;
  freight_cents: number;
  customs_cents: number;
  landed_cost_cents: number;
  lead_time_days: number | null;
  image_url: string | null;
  /** All product photos in display order (gallery / Quick View). Falls back to image_url when absent. */
  image_urls?: string[];
  /** Photos and videos in gallery order. When present it takes precedence over image_urls. */
  media?: GalleryMedia[];
  has_swatch_video: boolean;
  is_demo?: boolean;
  /** Multi-commodity catalogue (migration 015); shown when present. */
  is_featured?: boolean;
  category_name?: string | null;
  moq?: number | null;
  unit_of_measure?: string | null;
  price_tiers?: { min_qty: number; unit_price_cents: number }[];
}

export interface TrendPoolView {
  id: string;
  title: string;
  description: string | null;
  category: ProductCategory;
  origin_country: string;
  destination_country: string;
  target_cents: number;
  pledged_cents: number;
  min_contribution_cents: number;
  freight_total_cents: number;
  member_count: number;
  max_members: number;
  deadline: string;
  status: 'open' | 'funded' | string;
  image_url: string | null;
  my_contribution_cents: number;
  my_payment_status?: EscrowStatus | null;
  is_demo?: boolean;
}

export interface OrderView {
  id: string;
  order_type: OrderType;
  escrow_status: EscrowStatus;
  total_cents: number;
  created_at: string;
  product_title: string;
  /** Migration 021; absent = paid in full. */
  payment_structure?: string | null;
  /** Set for orders created from an accepted RFQ quote. */
  is_rfq?: boolean;
}
