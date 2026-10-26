import { formatUSD } from '@/lib/format';
import type { Share } from '@/lib/supplier-dashboard';

/** Fixed categorical order (validated for the dark card: lightness band, chroma, CVD and normal-vision ΔE). "Other" is neutral. */
const SLOT = ['#3987e5', '#d95926', '#199e70'] as const;
const OTHER = '#525252';
const colorOf = (s: Share, i: number) => (s.key === 'other' ? OTHER : SLOT[i] ?? OTHER);

const R = 52;
const STROKE = 22;
const C = 2 * Math.PI * R;
const GAP = 3; // surface gap between segments, in px of arc

/**
 * Sellsy "Top selling products": share of goods sales by category as a gapped donut, with a legend that
 * carries the label and percentage in text (identity never relies on colour alone). Hover a segment for its value.
 */
export default function CategoryDonut({ shares }: { shares: Share[] }) {
  let offset = 0;
  const arcs = shares.map((s, i) => {
    const len = (s.pct / 100) * C;
    const dash = Math.max(0, len - (shares.length > 1 ? GAP : 0));
    const arc = { s, i, dash, offset };
    offset += len;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90" role="img"
        aria-label={`Goods sales by category: ${shares.map((s) => `${s.label} ${s.pct}%`).join(', ')}`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth={STROKE} />
        {arcs.map(({ s, i, dash, offset: o }) => (
          <circle key={s.key} cx="70" cy="70" r={R} fill="none" stroke={colorOf(s, i)} strokeWidth={STROKE}
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-o} className="transition-opacity hover:opacity-80">
            <title>{`${s.label}: ${s.pct}% · ${formatUSD(s.cents)}`}</title>
          </circle>
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-2.5 text-sm">
        {shares.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s, i) }} />
            <span className="min-w-0 flex-1 truncate text-neutral-700">{s.label}</span>
            <span className="tabular-nums text-neutral-900">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
