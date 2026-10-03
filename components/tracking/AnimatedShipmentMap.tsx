'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { CheckCircle2, Clock, MapPin, PackageCheck, Plane, ShieldCheck, Truck } from 'lucide-react';
import {
  buildRoute, clamp01, deriveStatus, isGeoPoint, positionAt, progressFraction, splitAt, unwrapLongitudes,
  type DisplayStatus, type GeoPoint,
} from '@/lib/tracking/route';

// Leaflet touches `window` at import time → client-only.
const LeafletRouteLayer = dynamic(() => import('./LeafletRouteLayer'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-100" aria-hidden />,
});

export interface ShipmentTracking {
  discharge_timestamp: string | null;
  eta_timestamp: string | null;
  origin_port_coords: GeoPoint | null;
  destination_coords: GeoPoint | null;
  route_waypoints: unknown;
  current_status: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
}

const STATUS_META: Record<DisplayStatus, { label: string; icon: typeof Plane; cls: string }> = {
  AWAITING_DISPATCH: { label: 'Awaiting dispatch', icon: Clock, cls: 'bg-slate-100 text-slate-700' },
  IN_TRANSIT: { label: 'In transit', icon: Plane, cls: 'bg-brand-50 text-brand-800 ring-1 ring-brand-100' },
  ARRIVED: { label: 'Arrived', icon: MapPin, cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20' },
  CUSTOMS_CLEARED: { label: 'Customs cleared', icon: ShieldCheck, cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', icon: Truck, cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20' },
  DELIVERED: { label: 'Delivered', icon: PackageCheck, cls: 'bg-emerald-600 text-white' },
};

const INTRO_MS = 2200;
const TICK_MS = 15_000;
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

/** Real-time clock that re-renders every TICK_MS (progress over days needs no faster). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Animated shipment tracker.
 *   t = (now − discharge) / (eta − discharge)
 * The marker glides from origin to its current position on first render, then
 * advances in real time along the great-circle route (by distance, not by
 * waypoint index). When t ≥ 1 the status flips to ARRIVED automatically.
 * Display-only: escrow state is driven server-side, never from this component.
 */
export default function AnimatedShipmentMap({ tracking, escrowStatus, className }: {
  tracking: ShipmentTracking;
  escrowStatus?: string | null;
  className?: string;
}) {
  const now = useNow();
  const reducedMotion = usePrefersReducedMotion();

  const origin = isGeoPoint(tracking.origin_port_coords) ? tracking.origin_port_coords : null;
  const destination = isGeoPoint(tracking.destination_coords) ? tracking.destination_coords : null;
  const route = useMemo(
    () => (origin && destination ? buildRoute(origin, tracking.route_waypoints, destination) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin?.lat, origin?.lng, destination?.lat, destination?.lng, JSON.stringify(tracking.route_waypoints)],
  );

  const rawT = progressFraction(now, tracking.discharge_timestamp, tracking.eta_timestamp);
  const targetT = rawT === null ? 0 : clamp01(rawT);
  const status = deriveStatus(rawT, tracking.current_status, escrowStatus ?? null);
  // Once ops report arrival or later, pin the marker at the destination.
  const effectiveT = ['ARRIVED', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status) ? 1 : targetT;

  // Intro animation: displayT eases 0 → effectiveT, then tracks it.
  const [displayT, setDisplayT] = useState(reducedMotion ? effectiveT : 0);
  const introDone = useRef(false);
  useEffect(() => {
    if (introDone.current || reducedMotion) { setDisplayT(effectiveT); introDone.current = true; return; }
    let raf = 0;
    const start = performance.now();
    const step = (ts: number) => {
      const k = Math.min(1, (ts - start) / INTRO_MS);
      setDisplayT(effectiveT * easeOutCubic(k));
      if (k < 1) raf = requestAnimationFrame(step); else introDone.current = true;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [effectiveT, reducedMotion]);

  const geometry = useMemo(() => {
    if (!route) return null;
    const { travelled, remaining } = splitAt(route, displayT);
    // Unwrap once across the whole path so both halves stay continuous.
    const full = unwrapLongitudes([...travelled, ...remaining.slice(1)]);
    const travelledU = full.slice(0, travelled.length);
    const remainingU = full.slice(travelled.length - 1);
    const { bearing } = positionAt(route, displayT);
    return { travelled: travelledU, remaining: remainingU, here: travelledU[travelledU.length - 1], bearing, all: full };
  }, [route, displayT]);

  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const pct = Math.round(effectiveT * 100);
  const remainingKm = route ? Math.max(0, Math.round(route.totalKm * (1 - effectiveT))) : null;
  const eta = tracking.eta_timestamp ? new Date(tracking.eta_timestamp) : null;
  const msLeft = eta ? eta.getTime() - now : null;
  const originLabel = tracking.origin_label ?? 'Origin hub';
  const destinationLabel = tracking.destination_label ?? 'Destination';

  return (
    <section className={clsx('card overflow-hidden', className)} aria-labelledby="shipment-tracking-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 id="shipment-tracking-title" className="text-sm font-semibold text-slate-900">Live shipment tracking</h2>
          <p className="text-xs text-slate-500">{originLabel} → {destinationLabel}</p>
        </div>
        <span role="status" aria-live="polite" className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', meta.cls)}>
          {status === 'DELIVERED' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <StatusIcon className="h-3.5 w-3.5" aria-hidden />}
          {meta.label.toUpperCase()}
        </span>
      </header>

      <div className="relative h-72 sm:h-80" role="region" aria-label={`Map of shipment route from ${originLabel} to ${destinationLabel}, ${pct}% complete`}>
        {geometry && origin && destination ? (
          <LeafletRouteLayer
            all={geometry.all}
            travelled={geometry.travelled}
            remaining={geometry.remaining}
            here={geometry.here}
            bearing={geometry.bearing}
            arrived={effectiveT >= 1}
            originLabel={originLabel}
            destinationLabel={destinationLabel}
          />
        ) : (
          <div className="grid h-full place-items-center bg-slate-50 text-sm text-slate-500">Route details will appear once the shipment is booked.</div>
        )}
      </div>

      <div className="space-y-3 px-5 py-4">
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>{tracking.discharge_timestamp
              ? `${Date.parse(tracking.discharge_timestamp) > now ? 'Departs' : 'Departed'} ${fmt(tracking.discharge_timestamp)}`
              : 'Not yet departed'}</span>
            <span>{eta ? `ETA ${fmt(eta.toISOString())}` : 'ETA pending'}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Journey progress"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% of the journey complete`}>
            <div className={clsx('h-full rounded-full', effectiveT >= 1 ? 'bg-emerald-500' : 'bg-brand-700')} style={{ width: `${Math.round(displayT * 100)}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Progress" value={`${pct}%`} />
          <Stat label="Remaining" value={remainingKm === null ? '—' : `${remainingKm.toLocaleString('en-US')} km`} />
          <Stat label={msLeft !== null && msLeft < 0 ? 'Arrived' : 'Time left'} value={msLeft === null ? '—' : msLeft <= 0 ? fmtShort(tracking.eta_timestamp!) : humanize(msLeft)} />
        </dl>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          Position is estimated from the carrier schedule. Your payment stays in escrow until you verify delivery.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function humanize(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  if (h >= 1) return `${h} h ${Math.floor((ms % 3_600_000) / 60_000)} m`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}
