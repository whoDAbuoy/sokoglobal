import 'server-only';
import { getSessionProfile } from '@/lib/supabase/server';

export interface CheckoutGroupView {
  id: string;
  buyer_id: string;
  funded_at: string | null;
  orders: { id: string; escrow_status: string; total_cents: number }[];
}

/**
 * Load a cart checkout for the signed-in buyer (RLS: buyers only see their
 * own groups and orders). Returns the session too, for role checks.
 */
export async function loadCheckoutGroup(id: string) {
  const ctx = await getSessionProfile();
  if (!ctx.user || !ctx.profile) return { ...ctx, group: null } as const;
  const { data } = await ctx.supabase
    .from('checkout_groups')
    .select('id, buyer_id, funded_at, orders ( id, escrow_status, total_cents )')
    .eq('id', id)
    .maybeSingle();
  const group = data && data.buyer_id === ctx.user.id ? (data as CheckoutGroupView) : null;
  return { ...ctx, group } as const;
}

/** Unpaid orders in the group — what the next payment would fund. */
export const unpaidOrders = (g: CheckoutGroupView) => g.orders.filter((o) => o.escrow_status === 'pending_payment');
