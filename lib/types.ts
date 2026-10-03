export type UserRole = 'supplier' | 'importer' | 'admin';
export type ProductCategory = 'beauty' | 'clothing';
export type ProductStatus = 'draft' | 'pending_review' | 'live' | 'archived';
export type MediaType = 'image' | 'swatch_video';
export type OrderType = 'trial' | 'pool' | 'standard';

export type EscrowStatus =
  | 'pending_payment'
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

/** Shape rendered by the Trial Batch card on the buyer dashboard. */
export interface TrialProductView {
  id: string;
  title: string;
  brand: string | null;
  category: ProductCategory;
  origin_country: string;
  supplier_name: string;
  supplier_verified: boolean;
  trial_units: number;
  unit_price_cents: number;
  goods_cents: number;
  freight_cents: number;
  customs_cents: number;
  landed_cost_cents: number;
  lead_time_days: number | null;
  image_url: string | null;
  has_swatch_video: boolean;
  is_demo?: boolean;
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
}
