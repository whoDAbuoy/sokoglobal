'use client';

import { startTransition, useActionState, useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, PencilLine, Truck } from 'lucide-react';
import { saveShipment, type ShipmentActionState } from '@/app/supplier/orders/actions';
import { CARRIERS, SHIPMENT_STAGES, SHIPMENT_STAGE_LABEL, type ShipmentStage } from '@/lib/shipping';

export interface ExistingShipment {
  status: ShipmentStage; carrier_name: string; tracking_number: string; tracking_url: string | null; estimated_delivery: string | null;
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

/**
 * "Fulfil & ship" modal: waybill, carrier, tracking link, estimated delivery and
 * stage. Stages only move forward; the same dialog later marks the parcel out
 * for delivery or delivered.
 */
export default function ShipOrderDialog({ orderId, orderLabel, existing, milestoneBalanceDue = false }: {
  orderId: string; orderLabel: string; existing?: ExistingShipment | null;
  /** Milestone order with the 70% balance still unpaid: dispatch makes it payable. */
  milestoneBalanceDue?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [state, action, pending] = useActionState<ShipmentActionState, FormData>(saveShipment, null);
  const stages = SHIPMENT_STAGES.slice(existing ? SHIPMENT_STAGES.indexOf(existing.status) : 0);
  const defaultStage: ShipmentStage = existing ? (existing.status === 'label_created' ? 'in_transit' : existing.status) : 'in_transit';

  useEffect(() => {
    if (state?.ok) { toast.success(state.message); ref.current?.close(); }
  }, [state]);

  const err = (k: string) => state?.errors?.[k];
  const field = (k: string) => ({ 'aria-invalid': !!err(k) || undefined, 'aria-describedby': err(k) ? `${uid}-${k}-err` : undefined });

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={existing ? 'btn-secondary px-3 py-1.5 text-sm' : 'btn-primary px-3 py-1.5 text-sm'}>
        {existing ? <PencilLine className="h-3.5 w-3.5" aria-hidden /> : <Truck className="h-3.5 w-3.5" aria-hidden />}
        {existing ? 'Update shipment' : 'Fulfil & ship'}
      </button>

      <dialog ref={ref} aria-labelledby={`${uid}-title`} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className="w-[calc(100%-2rem)] max-w-lg rounded-lg border border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10">
        {/* onSubmit (not action=) so a validation error doesn't reset what the supplier typed. */}
        <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }}>
          <input type="hidden" name="orderId" value={orderId} />
          <div className="px-6 pb-2 pt-6">
            <h2 id={`${uid}-title`} className="flex items-center gap-2 text-base font-semibold"><Truck className="h-4 w-4" aria-hidden /> {existing ? 'Update shipment' : 'Fulfil & ship'}</h2>
            <p className="mt-1 text-sm text-neutral-600">{orderLabel}</p>
            {milestoneBalanceDue && (
              <p className="mt-3 rounded-md border px-3 py-2 text-xs tone-transit">
                Milestone order: the buyer has paid 30%. Handing it to the carrier asks them to pay the remaining 70% into escrow.
              </p>
            )}
          </div>

          <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-carrier`} className="label">Carrier</label>
              <input id={`${uid}-carrier`} name="carrier" list={`${uid}-carriers`} required maxLength={80} defaultValue={existing?.carrier_name ?? ''}
                placeholder="e.g. DHL Express" className="input" {...field('carrier')} />
              <datalist id={`${uid}-carriers`}>{CARRIERS.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              {err('carrier') && <p id={`${uid}-carrier-err`} className="mt-1 text-xs text-red-600">{err('carrier')}</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-waybill`} className="label">Waybill / tracking number</label>
              <input id={`${uid}-waybill`} name="trackingNumber" required maxLength={80} defaultValue={existing?.tracking_number ?? ''}
                autoComplete="off" spellCheck={false} className="input font-mono" {...field('trackingNumber')} />
              {err('trackingNumber') && <p id={`${uid}-trackingNumber-err`} className="mt-1 text-xs text-red-600">{err('trackingNumber')}</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${uid}-url`} className="label">Tracking link <span className="font-normal text-neutral-500">(optional)</span></label>
              <input id={`${uid}-url`} name="trackingUrl" type="url" inputMode="url" maxLength={500} defaultValue={existing?.tracking_url ?? ''}
                placeholder="https://… (we build DHL links automatically)" className="input" {...field('trackingUrl')} />
              {err('trackingUrl') && <p id={`${uid}-trackingUrl-err`} className="mt-1 text-xs text-red-600">{err('trackingUrl')}</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-eta`} className="label">Estimated delivery</label>
              <input id={`${uid}-eta`} name="estimatedDelivery" type="date" defaultValue={dateInput(existing?.estimated_delivery ?? null)} className="input" {...field('estimatedDelivery')} />
              {err('estimatedDelivery') && <p id={`${uid}-estimatedDelivery-err`} className="mt-1 text-xs text-red-600">{err('estimatedDelivery')}</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-stage`} className="label">Stage</label>
              <select id={`${uid}-stage`} name="status" defaultValue={defaultStage} className="input" {...field('status')}>
                {stages.map((s) => <option key={s} value={s}>{SHIPMENT_STAGE_LABEL[s]}</option>)}
              </select>
              {err('status') && <p id={`${uid}-status-err`} className="mt-1 text-xs text-red-600">{err('status')}</p>}
            </div>
          </div>

          {state && !state.ok && (
            <p role="alert" className="mx-6 mb-2 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{state.message}</p>
          )}

          <div className="flex justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-4">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />} Save shipment
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
