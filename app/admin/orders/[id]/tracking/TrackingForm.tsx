'use client';

import { useActionState, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, Loader2, MapPin, PackageCheck, Plane, Plus, Route, Save,
  ShieldCheck, Trash2, Truck,
} from 'lucide-react';
import AnimatedShipmentMap from '@/components/tracking/AnimatedShipmentMap';
import { isGeoPoint, type GeoPoint } from '@/lib/tracking/route';
import {
  escrowEffect, HUBS, MAX_WAYPOINTS, parsePathJson, parsePointJson, SHIPMENT_STATUSES, validateTracking,
  type FieldErrors, type ShipmentStatus, type TrackingDraft,
} from '@/lib/tracking/validate';
import { saveTracking, type TrackingActionState } from './actions';

export interface TrackingFormOrder {
  id: string;
  escrowStatus: string;
  currentStatus: string;
  discharge: string | null;
  eta: string | null;
  origin: GeoPoint | null;
  destination: GeoPoint | null;
  waypoints: unknown[];
  originLabel: string | null;
  destinationLabel: string | null;
  updatedAt: string | null;
}

const STATUS_UI: Record<ShipmentStatus, { label: string; icon: typeof Plane }> = {
  awaiting_dispatch: { label: 'Awaiting dispatch', icon: Clock },
  in_transit: { label: 'In transit', icon: Plane },
  arrived: { label: 'Arrived', icon: MapPin },
  customs_cleared: { label: 'Customs cleared', icon: ShieldCheck },
  out_for_delivery: { label: 'Out for delivery', icon: Truck },
  delivered: { label: 'Delivered', icon: PackageCheck },
};

/** ISO → value for <input type="datetime-local"> in the operator's local time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value (local time) → ISO UTC, or null when blank/invalid. */
function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const pointText = (p: GeoPoint | null) => (p ? JSON.stringify({ lat: p.lat, lng: p.lng }) : '');
const pathText = (arr: unknown[]) => (arr.length ? JSON.stringify(arr.filter(isGeoPoint).map((p) => ({ lat: p.lat, lng: p.lng })), null, 0) : '');

export default function TrackingForm({ order }: { order: TrackingFormOrder }) {
  const [state, formAction, pending] = useActionState<TrackingActionState, FormData>(saveTracking, null);
  const uid = useId();

  const [status, setStatus] = useState<string>(order.currentStatus);
  const [dischargeLocal, setDischargeLocal] = useState(toLocalInput(order.discharge));
  const [etaLocal, setEtaLocal] = useState(toLocalInput(order.eta));
  const [originText, setOriginText] = useState(pointText(order.origin));
  const [destinationText, setDestinationText] = useState(pointText(order.destination));
  const [waypointsText, setWaypointsText] = useState(pathText(order.waypoints));
  const [originLabel, setOriginLabel] = useState(order.originLabel ?? '');
  const [destinationLabel, setDestinationLabel] = useState(order.destinationLabel ?? '');
  const [touched, setTouched] = useState(false);
  const [tz, setTz] = useState('local time');
  useEffect(() => { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);

  const draft: TrackingDraft = {
    status, discharge: localToIso(dischargeLocal), eta: localToIso(etaLocal),
    originText, destinationText, waypointsText, originLabel, destinationLabel,
  };
  const existing = {
    discharge_timestamp: order.discharge, eta_timestamp: order.eta,
    origin_port_coords: order.origin, destination_coords: order.destination, escrow_status: order.escrowStatus,
  };
  const check = validateTracking(draft, existing);
  const clientErrors: FieldErrors = check.ok ? {} : check.errors;
  // Server errors win right after a submit; live client errors otherwise.
  const errors: FieldErrors = state && !state.ok && state.errors ? { ...clientErrors, ...state.errors } : touched ? clientErrors : {};

  const effect = SHIPMENT_STATUSES.includes(status as ShipmentStatus) ? escrowEffect(status as ShipmentStatus, order.escrowStatus) : null;
  const closed = ['released', 'refunded', 'cancelled'].includes(order.escrowStatus);

  // Live preview of the merged draft
  const preview = useMemo(() => {
    const o = parsePointJson(originText), d = parsePointJson(destinationText), w = parsePathJson(waypointsText);
    const origin = (o.ok && o.value) || order.origin;
    const dest = (d.ok && d.value) || order.destination;
    if (!origin || !dest) return null;
    return {
      discharge_timestamp: localToIso(dischargeLocal) ?? order.discharge,
      eta_timestamp: localToIso(etaLocal) ?? order.eta,
      origin_port_coords: origin, destination_coords: dest,
      route_waypoints: w.ok && w.value ? w.value : order.waypoints,
      current_status: status, origin_label: originLabel || 'Origin', destination_label: destinationLabel || 'Destination',
    };
  }, [originText, destinationText, waypointsText, dischargeLocal, etaLocal, status, originLabel, destinationLabel, order]);

  const transitHours = (() => {
    const s = Date.parse(draft.discharge ?? order.discharge ?? ''), e = Date.parse(draft.eta ?? order.eta ?? '');
    return Number.isFinite(s) && Number.isFinite(e) && e > s ? Math.round((e - s) / 3_600_000) : null;
  })();
  const waypointCount = (() => { const w = parsePathJson(waypointsText); return w.ok && w.value ? w.value.length : 0; })();

  function applyHub(code: string, which: 'origin' | 'destination') {
    const h = HUBS.find((x) => x.code === code);
    if (!h) return;
    const json = JSON.stringify({ lat: h.lat, lng: h.lng });
    if (which === 'origin') { setOriginText(json); setOriginLabel(`${h.name} (${h.code})`); }
    else { setDestinationText(json); setDestinationLabel(`${h.name} (${h.code})`); }
  }
  function addWaypoint(code: string) {
    const h = HUBS.find((x) => x.code === code);
    if (!h) return;
    const cur = parsePathJson(waypointsText);
    const list = cur.ok && cur.value ? cur.value : [];
    if (list.length >= MAX_WAYPOINTS) return;
    setWaypointsText(JSON.stringify([...list, { lat: h.lat, lng: h.lng }]));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    setTouched(true);
    if (!check.ok) { e.preventDefault(); return; }
    if (status === 'delivered' && order.currentStatus !== 'delivered'
        && !window.confirm('Mark as DELIVERED? The buyer will be asked to inspect the goods and release escrow.')) {
      e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[1fr_26rem]">
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="discharge" value={draft.discharge ?? ''} />
      <input type="hidden" name="eta" value={draft.eta ?? ''} />

      <div className="space-y-6">
        {closed && (
          <p role="alert" className="flex items-center gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
            <AlertCircle className="h-4 w-4" aria-hidden /> This order is {order.escrowStatus}; tracking is read-only.
          </p>
        )}

        {/* Status */}
        <fieldset className="card p-5" disabled={closed}>
          <legend className="sr-only">Shipment status</legend>
          <SectionTitle icon={Route} title="Shipment status" hint={`Escrow is currently “${order.escrowStatus.replace(/_/g, ' ')}”.`} />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-describedby={errors.status ? `${uid}-status-err` : undefined}>
            {SHIPMENT_STATUSES.map((s) => {
              const { label, icon: Icon } = STATUS_UI[s];
              const active = status === s;
              return (
                <label key={s} className={clsx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition focus-within:ring-4 focus-within:ring-brand-600/20',
                  active ? 'border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700' : 'border-slate-200 text-slate-700 hover:border-slate-300')}>
                  <input type="radio" name="status" value={s} checked={active} onChange={() => setStatus(s)} className="sr-only" />
                  <Icon className="h-4 w-4 shrink-0" aria-hidden /> {label}
                </label>
              );
            })}
          </div>
          <FieldError id={`${uid}-status-err`} msg={errors.status} />
          {effect && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
              Saving will move escrow to “{effect.replace(/_/g, ' ')}”.{effect === 'delivered_pending_verification' && ' The buyer is then asked to verify the goods and release payment.'}
            </p>
          )}
        </fieldset>

        {/* Schedule */}
        <fieldset className="card p-5" disabled={closed}>
          <legend className="sr-only">Schedule</legend>
          <SectionTitle icon={Clock} title="Schedule" hint={`Times are in your time zone (${tz}) and stored in UTC. Leave blank to keep the saved value.`} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-dis`} className="label">Departure (discharge)</label>
              <input id={`${uid}-dis`} type="datetime-local" value={dischargeLocal} onChange={(e) => setDischargeLocal(e.target.value)}
                aria-invalid={!!errors.discharge} aria-describedby={`${uid}-dis-err`} className={clsx('input', errors.discharge && 'border-red-400')} />
              <FieldError id={`${uid}-dis-err`} msg={errors.discharge} />
            </div>
            <div>
              <label htmlFor={`${uid}-eta`} className="label">ETA (arrival)</label>
              <input id={`${uid}-eta`} type="datetime-local" value={etaLocal} onChange={(e) => setEtaLocal(e.target.value)}
                min={dischargeLocal || undefined}
                aria-invalid={!!errors.eta} aria-describedby={`${uid}-eta-err`} className={clsx('input', errors.eta && 'border-red-400')} />
              <FieldError id={`${uid}-eta-err`} msg={errors.eta} />
            </div>
          </div>
          {status !== 'awaiting_dispatch' && Date.parse(draft.discharge ?? order.discharge ?? '') > Date.now() && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Departure is in the future — the buyer’s map shows “Awaiting dispatch” until then.
            </p>
          )}
          {transitHours !== null && (
            <p className="mt-2 text-xs text-slate-500">
              Transit time: {transitHours >= 48 ? `${(transitHours / 24).toFixed(1)} days` : `${transitHours} h`}
            </p>
          )}
        </fieldset>

        {/* Route */}
        <fieldset className="card p-5" disabled={closed}>
          <legend className="sr-only">Route</legend>
          <div className="space-y-5">
          <SectionTitle icon={MapPin} title="Route" hint='Coordinates are JSON: {"lat": 6.5774, "lng": 3.3212}. Pick a hub to fill them in.' />
          <Endpoint uid={`${uid}-o`} title="Origin port / hub" side="origin" text={originText} setText={setOriginText}
            label={originLabel} setLabel={setOriginLabel} onHub={(c) => applyHub(c, 'origin')}
            error={errors.origin} labelError={errors.originLabel} nameJson="origin" nameLabel="originLabel" />
          <Endpoint uid={`${uid}-d`} title="Destination" side="destination" text={destinationText} setText={setDestinationText}
            label={destinationLabel} setLabel={setDestinationLabel} onHub={(c) => applyHub(c, 'destination')}
            error={errors.destination} labelError={errors.destinationLabel} nameJson="destination" nameLabel="destinationLabel" />

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <label htmlFor={`${uid}-wp`} className="label mb-0">Route waypoints <span className="font-normal text-slate-500">({waypointCount}/{MAX_WAYPOINTS})</span></label>
              <div className="flex items-center gap-2">
                <label htmlFor={`${uid}-wp-add`} className="sr-only">Add transit hub</label>
                <select id={`${uid}-wp-add`} value="" onChange={(e) => addWaypoint(e.target.value)} className="input w-auto py-1.5 text-xs">
                  <option value="">+ Add transit hub…</option>
                  {HUBS.map((h) => <option key={h.code} value={h.code}>{h.code} · {h.name}</option>)}
                </select>
                <button type="button" onClick={() => setWaypointsText('[]')} className="btn-secondary px-2.5 py-1.5 text-xs" title="Remove all waypoints (direct route)">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear
                </button>
              </div>
            </div>
            <textarea id={`${uid}-wp`} name="waypoints" rows={3} spellCheck={false} value={waypointsText} onChange={(e) => setWaypointsText(e.target.value)}
              placeholder='[{"lat": 25.2532, "lng": 55.3657}]'
              aria-invalid={!!errors.waypoints} aria-describedby={`${uid}-wp-err ${uid}-wp-hint`}
              className={clsx('input mt-1.5 font-mono text-xs', errors.waypoints && 'border-red-400')} />
            <p id={`${uid}-wp-hint`} className="mt-1 text-[11px] text-slate-500">
              Ordered stops between origin and destination. Blank = keep saved route; <code>[]</code> = direct route.
            </p>
            <FieldError id={`${uid}-wp-err`} msg={errors.waypoints} />
          </div>
          </div>
        </fieldset>
      </div>

      {/* Preview + save */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        {preview ? (
          <AnimatedShipmentMap tracking={preview} escrowStatus={order.escrowStatus} />
        ) : (
          <div className="card grid h-64 place-items-center p-6 text-center text-sm text-slate-500">
            <div><Plus className="mx-auto mb-2 h-5 w-5" aria-hidden />Add an origin and destination to preview the buyer’s map.</div>
          </div>
        )}

        <div className="card p-4">
          {state && (
            <p role="status" className={clsx('mb-3 flex items-start gap-2 text-sm', state.ok ? 'text-emerald-700' : 'text-red-600')}>
              {state.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              {state.message}
            </p>
          )}
          <button type="submit" disabled={pending || closed} className="btn-primary w-full">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Save tracking
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            {order.updatedAt ? `Last updated ${new Date(order.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not booked yet'}
            {' · '}the buyer sees changes immediately
          </p>
        </div>
      </aside>
    </form>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Plane; title: string; hint?: string }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 ring-1 ring-brand-100"><Icon className="h-4 w-4 text-brand-700" aria-hidden /></span>
      <div><h2 className="font-semibold text-slate-900">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
    </div>
  );
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  return msg ? <p id={id} role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" aria-hidden />{msg}</p> : <span id={id} hidden />;
}

function Endpoint({ uid, title, side, text, setText, label, setLabel, onHub, error, labelError, nameJson, nameLabel }: {
  uid: string; title: string; side: 'origin' | 'destination'; text: string; setText: (s: string) => void;
  label: string; setLabel: (s: string) => void; onHub: (code: string) => void;
  error?: string; labelError?: string; nameJson: string; nameLabel: string;
}) {
  const hubs = HUBS.filter((h) => h.side === side || h.side === 'transit');
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <label htmlFor={`${uid}-hub`} className="sr-only">{title}: choose a hub</label>
        <select id={`${uid}-hub`} value="" onChange={(e) => onHub(e.target.value)} className="input w-auto py-1.5 text-xs">
          <option value="">Choose hub…</option>
          {hubs.map((h) => <option key={h.code} value={h.code}>{h.code} · {h.name}</option>)}
        </select>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <div>
          <label htmlFor={`${uid}-label`} className="mb-1 block text-xs font-medium text-slate-600">Display name</label>
          <input id={`${uid}-label`} name={nameLabel} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)}
            aria-invalid={!!labelError} className="input py-2 text-sm" placeholder="e.g. London Heathrow (LHR)" />
          <FieldError id={`${uid}-label-err`} msg={labelError} />
        </div>
        <div>
          <label htmlFor={`${uid}-json`} className="mb-1 block text-xs font-medium text-slate-600">Coordinates (JSON)</label>
          <input id={`${uid}-json`} name={nameJson} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            aria-invalid={!!error} aria-describedby={`${uid}-json-err`} placeholder='{"lat": 51.47, "lng": -0.4543}'
            className={clsx('input py-2 font-mono text-xs', error && 'border-red-400')} />
          <FieldError id={`${uid}-json-err`} msg={error} />
        </div>
      </div>
    </div>
  );
}
