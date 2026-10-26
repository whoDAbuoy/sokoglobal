'use client';

import { useId, useMemo, useState } from 'react';
import { formatUSD } from '@/lib/format';
import { compactUSD, rollingAverage, splinePath, type DayPoint } from '@/lib/supplier-dashboard';

const W = 640;
const H = 210;
const PAD = { top: 18, right: 8, bottom: 26, left: 8 };

/**
 * Minimal spline area chart (Sellsy "Revenue" card): one mint series — the trailing 7-day average of daily
 * sales, so sparse B2B orders read as a trend — no grid, a quiet date axis and a crosshair + tooltip
 * (that day's sales and the average) on hover / focus. The strongest day is called out until the pointer takes over.
 * A visually hidden table carries the same numbers for screen readers.
 */
export default function RevenueChart({ points: all, warmup = 0, caption }: {
  /** Daily points, oldest first. The first `warmup` days only feed the moving average and are not drawn. */
  points: DayPoint[]; warmup?: number; caption: string;
}) {
  const points = useMemo(() => all.slice(warmup), [all, warmup]);
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const avg = rollingAverage(all.map((p) => p.cents), 7).slice(warmup);
    const max = Math.max(1, ...avg);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const pts = avg.map((v, i) => ({ x: PAD.left + i * step, y: PAD.top + innerH - (v / max) * innerH * 0.9 }));
    const base = PAD.top + innerH;
    const line = splinePath(pts, PAD.top, base);
    const area = pts.length ? `${line} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z` : '';
    let peak = 0;
    avg.forEach((v, i) => { if (v > avg[peak]) peak = i; });
    return { pts, line, area, base, step, peak, avg };
  }, [all, points, warmup]);

  if (!points.length) return null;
  const empty = points.every((p) => p.cents === 0);
  const active = hover ?? (empty ? null : geo.peak);
  const tickEvery = Math.max(1, Math.ceil(points.length / 7));

  const pick = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * W;
    const i = geo.step ? Math.round((x - PAD.left) / geo.step) : 0;
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y select-none" role="img" aria-label={caption}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const from = active ?? points.length - 1;
          setHover(Math.min(points.length - 1, Math.max(0, from + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setHover(null)}>
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8fd3cc" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#8fd3cc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={W - PAD.right} y1={geo.base} y2={geo.base} stroke="rgb(255 255 255 / 0.08)" />
        <path d={geo.area} fill={`url(#fill-${gid})`} />
        <path d={geo.line} fill="none" stroke="#8fd3cc" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (i % tickEvery === 0 || i === points.length - 1) && (i === points.length - 1 || points.length - 1 - i >= tickEvery / 2) ? (
          <text key={p.date} x={geo.pts[i].x} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            className="fill-neutral-500 text-[11px]">{p.label}</text>
        ) : null)}
        {active !== null && (
          <g pointerEvents="none">
            <line x1={geo.pts[active].x} x2={geo.pts[active].x} y1={PAD.top} y2={geo.base} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="3 4" />
            <circle cx={geo.pts[active].x} cy={geo.pts[active].y} r={5} fill="#121212" stroke="#8fd3cc" strokeWidth={2} />
          </g>
        )}
      </svg>
      {active !== null && (() => {
        // Near the top of the plot the callout drops below the point so it never covers the headline figure.
        const below = geo.pts[active].y < PAD.top + (H - PAD.top - PAD.bottom) * 0.45;
        return (
          <div aria-live="polite" className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-xl bg-snow px-2.5 py-1.5 text-center text-[#050505] shadow-lg ${below ? '' : '-translate-y-full'}`}
            style={{
              left: `${Math.min(86, Math.max(14, (geo.pts[active].x / W) * 100))}%`,
              top: `calc(${(geo.pts[active].y / H) * 100}% ${below ? '+ 12px' : '- 12px'})`,
            }}>
            <p className="text-[10px] leading-tight text-[#525252]">{points[active].label}</p>
            <p className="text-xs font-semibold tabular-nums leading-tight">{formatUSD(points[active].cents, true)}</p>
            <p className="text-[10px] tabular-nums leading-tight text-[#525252]">7-day avg {compactUSD(geo.avg[active])}</p>
          </div>
        );
      })()}
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead><tr><th>Day</th><th>Goods sales</th><th>7-day average</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={p.date}><td>{p.label}</td><td>{compactUSD(p.cents)}</td><td>{compactUSD(geo.avg[i])}</td></tr>)}</tbody>
        </table>
      </figcaption>
    </figure>
  );
}
