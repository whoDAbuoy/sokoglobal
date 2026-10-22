'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { validateShipmentDraft } from '@/lib/shipping';
import { dispatchNotificationsAfterResponse } from '@/lib/notifications/dispatch';

export type ShipmentActionState = { ok: boolean; message: string; errors?: Record<string, string> } | null;

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * "Fulfil & ship". Server Actions are public endpoints, so the supplier role is
 * checked here, the form is re-validated with the same rules the dialog uses,
 * and supplier_save_shipment() (migration 021) checks ownership, payment state
 * and forward-only progress again in Postgres. The buyer's dispatch alert is
 * queued by Postgres and sent right after the response.
 */
export async function saveShipment(_prev: ShipmentActionState, form: FormData): Promise<ShipmentActionState> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'supplier') return { ok: false, message: 'Supplier access required.' };

  const orderId = str(form.get('orderId'));
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };

  // RLS: suppliers only see shipments of their own orders.
  const { data: existing } = await supabase.from('shipments').select('status, dispatched_at').eq('order_id', orderId).maybeSingle();
  const result = validateShipmentDraft({
    carrier: str(form.get('carrier')), trackingNumber: str(form.get('trackingNumber')), trackingUrl: str(form.get('trackingUrl')),
    estimatedDelivery: str(form.get('estimatedDelivery')), status: str(form.get('status')),
  }, existing ?? null);
  if (!result.ok) return { ok: false, message: result.errors.form ?? 'Please fix the highlighted fields.', errors: result.errors as Record<string, string> };

  const v = result.value;
  const { error } = await supabase.rpc('supplier_save_shipment', {
    p_order_id: orderId, p_carrier: v.carrier, p_tracking_number: v.trackingNumber, p_tracking_url: v.trackingUrl,
    p_estimated_delivery: v.estimatedDelivery, p_status: v.status,
  });
  if (error) return { ok: false, message: friendlyError(error.message) };

  dispatchNotificationsAfterResponse();
  revalidatePath('/supplier/orders');
  return { ok: true, message: v.status === 'label_created' ? 'Waybill saved.' : v.status === 'delivered' ? 'Marked as delivered — the buyer has been asked to verify.' : 'Shipment updated — the buyer has been notified.' };
}
