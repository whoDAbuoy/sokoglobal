'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { validateTracking, type FieldErrors, type TrackingDraft } from '@/lib/tracking/validate';

export type TrackingActionState = { ok: boolean; message: string; errors?: FieldErrors; savedAt?: string } | null;

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const isoOrNull = (v: FormDataEntryValue | null) => {
  const s = str(v).trim();
  return s ? s : null;
};

/**
 * Save shipment tracking. Server Actions are public POST endpoints, so:
 *   1. re-check the admin role here,
 *   2. re-validate everything with the same rules the form uses,
 *   3. call admin_set_shipment_tracking() with the admin's OWN session —
 *      the function re-checks the role in Postgres, and CHECK constraints
 *      validate coordinates and ETA > discharge once more.
 */
export async function saveTracking(_prev: TrackingActionState, form: FormData): Promise<TrackingActionState> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'admin') return { ok: false, message: 'Admin access required.' };

  const orderId = str(form.get('orderId'));
  if (!UUID_RE.test(orderId)) return { ok: false, message: 'Invalid order.' };

  const { data: existing, error: loadError } = await supabase
    .from('orders')
    .select('discharge_timestamp, eta_timestamp, origin_port_coords, destination_coords, escrow_status')
    .eq('id', orderId)
    .maybeSingle();
  if (loadError || !existing) return { ok: false, message: 'Order not found.' };

  const draft: TrackingDraft = {
    status: str(form.get('status')),
    discharge: isoOrNull(form.get('discharge')),     // the client converts local time → ISO UTC
    eta: isoOrNull(form.get('eta')),
    originText: str(form.get('origin')),
    destinationText: str(form.get('destination')),
    waypointsText: str(form.get('waypoints')),
    originLabel: str(form.get('originLabel')),
    destinationLabel: str(form.get('destinationLabel')),
  };
  const result = validateTracking(draft, existing);
  if (!result.ok) return { ok: false, message: result.errors.form ?? 'Please fix the highlighted fields.', errors: result.errors };

  const v = result.value;
  const { data: saved, error } = await supabase.rpc('admin_set_shipment_tracking', {
    p_order_id: orderId,
    p_status: v.status,
    p_discharge: v.discharge,
    p_eta: v.eta,
    p_origin: v.origin,
    p_destination: v.destination,
    p_waypoints: v.waypoints,
    p_origin_label: v.originLabel,
    p_destination_label: v.destinationLabel,
  });
  if (error) {
    const msg = error.message.includes('orders_eta_after_discharge') ? 'ETA must be after departure.'
      : error.message.includes('_is_point') || error.message.includes('_is_path') ? 'Coordinates were rejected by the database.'
      : friendlyError(error.message);
    return { ok: false, message: msg };
  }

  revalidatePath(`/admin/orders/${orderId}/tracking`);
  revalidatePath('/admin/orders');
  revalidatePath(`/dashboard/orders/${orderId}`);   // buyer's live map
  return {
    ok: true,
    message: `Saved. Shipment is “${String(saved?.current_status ?? v.status).replace(/_/g, ' ')}”; escrow is “${String(saved?.escrow_status ?? '').replace(/_/g, ' ')}”.`,
    savedAt: new Date().toISOString(),
  };
}
