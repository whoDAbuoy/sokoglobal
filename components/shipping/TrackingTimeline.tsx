'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Circle, ExternalLink, Loader2, MapPin, Plane, RefreshCw } from 'lucide-react';
import type { TrackResponse } from '@/lib/shipping/dhl';

const REFRESH_MS = 15 * 60_000;   // matches the server cache; DHL's daily quota is small
const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso))
  ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

/**
 * Live DHL Express tracking on the order page: Picked up → Customs → In transit → Out for delivery
 * → Delivered, with each stage's scan time and place, the latest checkpoints and DHL's ETA.
 * Renders nothing until DHL tracking is configured on the server.
 */
export default function TrackingTimeline({ orderId, trackingUrl, className }: { orderId: string; trackingUrl?: string | null; className?: string }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/shipping/track?orderId=${orderId}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null) as (TrackResponse & { error?: string }) | null;
      if (!res.ok || !json) setError(json?.error ?? 'Live tracking is unavailable right now.');
      else { setError(null); setData(json); }
    } catch { setError('Live tracking is unavailable right now.'); }
    setLoading(false);
  }, [orderId]);

  const delivered = data?.configured && data.tracking?.statusCode === 'delivered';
  useEffect(() => {
    void load();
    if (delivered) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, delivered]);

  if (data && !data.configured) return null;
  const t = data?.configured ? data.tracking : null;
  const eta = when(t?.estimatedDelivery ?? null);

  return (
    <section aria-labelledby={`dhl-${orderId}`} className={clsx('glass-card p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`dhl-${orderId}`} className="flex items-center gap-2 font-semibold text-neutral-900">
            <Plane className="h-4 w-4 text-amber-500" aria-hidden /> DHL Express live tracking
          </h2>
          {data?.configured && <p className="mt-0.5 font-mono text-xs text-neutral-500">Waybill {data.waybill}</p>}
        </div>
        <div className="flex items-center gap-2">
          {trackingUrl && (
            <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="glass-button h-8 px-3 text-xs">
              dhl.com <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh tracking" className="glass-button h-8 w-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      {!error && data?.configured && !t && !loading && (
        <p className="mt-4 text-sm text-neutral-600">DHL hasn&apos;t scanned this waybill yet. Updates usually appear within a few hours of pickup.</p>
      )}

      {t && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className={clsx('pill', delivered ? 'tone-escrow' : t.statusCode === 'failure' ? 'tone-danger' : 'tone-transit')}>{t.status}</span>
            {eta && !delivered && <span className="text-neutral-600">Estimated delivery <span className="font-medium text-neutral-900">{eta}</span></span>}
          </div>
          <ol className="mt-5 space-y-0" aria-label="Shipment stages">
            {t.stages.map((s, i) => (
              <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < t.stages.length - 1 && (
                  <span aria-hidden className={clsx('absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px', s.state === 'done' ? 'bg-[#5a9895]/70' : 'bg-neutral-200 dark:bg-snow/10')} />
                )}
                <span className="relative grid h-6 w-6 shrink-0 place-items-center">
                  {s.state === 'done'
                    ? <CheckCircle2 className="h-6 w-6 text-[#5a9895]" aria-hidden />
                    : s.state === 'current'
                      ? <><span className="absolute inset-0 rounded-full bg-teal-400/30 motion-safe:animate-pulse-ring" /><Circle className="h-6 w-6 fill-teal-400/20 text-teal-400" aria-hidden /></>
                      : <Circle className="h-6 w-6 text-neutral-300 dark:text-snow/20" aria-hidden />}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className={clsx('text-sm', s.state === 'upcoming' ? 'text-neutral-500' : 'font-medium text-neutral-900')}>
                    {s.label}<span className="sr-only"> — {s.state === 'done' ? 'completed' : s.state === 'current' ? 'in progress' : 'not yet'}</span>
                  </p>
                  {(s.at || s.location) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                      {when(s.at) && <time dateTime={s.at ?? undefined} className="tabular-nums">{when(s.at)}</time>}
                      {s.location && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" aria-hidden />{s.location}</span>}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {t.events.length > 0 && (
            <details className="glass-inset mt-5 px-4 py-2 text-sm">
              <summary className="cursor-pointer py-1 text-xs font-medium text-neutral-700">All DHL scans ({t.events.length})</summary>
              <ol className="mt-2 divide-y divide-black/[0.06] dark:divide-snow/[0.08]">
                {t.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="py-2">
                    <p className="text-neutral-900">{e.description}</p>
                    <p className="text-xs text-neutral-500"><time dateTime={e.at} className="tabular-nums">{when(e.at)}</time>{e.location ? ` · ${e.location}` : ''}</p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {!t && loading && !error && <div className="mt-4 grid h-24 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading DHL tracking" /></div>}
    </section>
  );
}
