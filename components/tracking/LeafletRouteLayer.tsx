'use client';

import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint } from '@/lib/tracking/route';

/**
 * Tiles: set NEXT_PUBLIC_MAP_TILE_URL to your provider (MapTiler, Stadia,
 * Mapbox raster, …) for production traffic. The default CARTO basemap is fine
 * for development; check its terms before high-volume commercial use.
 */
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const BRAND = '#1b348c';
const EMERALD = '#10b981';

const ll = (p: GeoPoint): [number, number] => [p.lat, p.lng];

/** Aircraft silhouette pointing north; rotated by the great-circle heading. */
function planeIcon(bearing: number, arrived: boolean) {
  const fill = arrived ? EMERALD : BRAND;
  return L.divIcon({
    className: 'sokoglobal-plane',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `
      <div style="position:relative;width:34px;height:34px">
        ${arrived ? '' : `<span style="position:absolute;inset:0;border-radius:9999px;background:${fill};opacity:.25;animation:sg-pulse 2s ease-out infinite"></span>`}
        <svg viewBox="0 0 24 24" width="34" height="34" style="position:relative;transform:rotate(${bearing.toFixed(1)}deg);filter:drop-shadow(0 1px 2px rgba(15,23,42,.35))" aria-hidden="true">
          <path fill="${fill}" stroke="#fff" stroke-width="1" stroke-linejoin="round"
            d="M12 2c.8 0 1.4.9 1.4 2v5.2l7.6 4.3v2l-7.6-2.2v4.4l2.1 1.6V21l-3.5-1-3.5 1v-1.7l2.1-1.6v-4.4L3 15.5v-2l7.6-4.3V4c0-1.1.6-2 1.4-2z"/>
        </svg>
      </div>`,
  });
}

function FitToRoute({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points.map(ll)), { padding: [36, 36], maxZoom: 6, animate: false });
    // Fit once per route — not on every animation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points.length, points[0]?.lat, points[0]?.lng, points.at(-1)?.lat, points.at(-1)?.lng]);
  return null;
}

export default function LeafletRouteLayer({
  all, travelled, remaining, here, bearing, arrived, originLabel, destinationLabel,
}: {
  all: GeoPoint[]; travelled: GeoPoint[]; remaining: GeoPoint[]; here: GeoPoint; bearing: number;
  arrived: boolean; originLabel: string; destinationLabel: string;
}) {
  // Re-create the icon only when the rounded heading changes (cheap, avoids DOM churn).
  const icon = useMemo(() => planeIcon(Math.round(bearing), arrived), [Math.round(bearing), arrived]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = all[0];
  const end = all[all.length - 1];

  return (
    <>
      <style>{`@keyframes sg-pulse{0%{transform:scale(.6);opacity:.45}100%{transform:scale(1.8);opacity:0}}
        .sokoglobal-plane{background:none;border:none}
        @media (prefers-reduced-motion: reduce){.sokoglobal-plane span{animation:none!important}}`}</style>
      <MapContainer
        center={ll(here)}
        zoom={3}
        minZoom={2}
        worldCopyJump
        scrollWheelZoom={false}
        className="h-full w-full"
        attributionControl
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FitToRoute points={all} />

        {/* Remaining leg: dashed */}
        <Polyline positions={remaining.map(ll)} pathOptions={{ color: BRAND, weight: 2.5, opacity: 0.55, dashArray: '6 8' }} />
        {/* Travelled leg: solid */}
        <Polyline positions={travelled.map(ll)} pathOptions={{ color: arrived ? EMERALD : BRAND, weight: 3.5, opacity: 0.95 }} />

        <CircleMarker center={ll(start)} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: BRAND, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -6]}>{originLabel}</Tooltip>
        </CircleMarker>
        <CircleMarker center={ll(end)} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: EMERALD, fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -6]} permanent={arrived}>{destinationLabel}</Tooltip>
        </CircleMarker>

        <Marker position={ll(here)} icon={icon} keyboard={false} title={arrived ? `Arrived at ${destinationLabel}` : 'Shipment position'} />
      </MapContainer>
    </>
  );
}
