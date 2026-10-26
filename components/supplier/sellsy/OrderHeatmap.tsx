import { HEAT_DAYS, HEAT_SLOTS, heatLevel, type Heatmap } from '@/lib/supplier-dashboard';

/** One hue, dim → bright on the dark card (sequential); level 0 is the empty well. */
const STEP = ['bg-snow/[0.06]', 'bg-[#2b4a73]', 'bg-[#3f6fae]', 'bg-[#6a9be0]', 'bg-[#a9c9f2]'] as const;
const DAY_NAME: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

/**
 * Sellsy "Order statistics": orders by weekday × four-hour slot (UTC). Each cell is a hover / focus
 * target with its own tooltip; the grid itself is a labelled table so it reads cell by cell.
 */
export default function OrderHeatmap({ data }: { data: Heatmap }) {
  return (
    <div>
      <table className="w-full border-separate border-spacing-1 text-[11px]">
        <caption className="sr-only">Orders by day of week and time of day (UTC)</caption>
        <thead>
          <tr>
            <th scope="col" className="w-11"><span className="sr-only">Time (UTC)</span></th>
            {HEAT_DAYS.map((d) => <th key={d} scope="col" className="pt-1 text-center font-normal text-neutral-500"><abbr title={DAY_NAME[d]} className="no-underline">{d}</abbr></th>)}
          </tr>
        </thead>
        <tbody>
          {HEAT_SLOTS.map((slot, r) => (
            <tr key={slot}>
              <th scope="row" className="pr-1 text-left font-normal tabular-nums text-neutral-500">{slot}</th>
              {HEAT_DAYS.map((d, c) => {
                const n = data.cells[r][c];
                const label = `${DAY_NAME[d]} ${slot}–${HEAT_SLOTS[r + 1] ?? '24:00'} UTC: ${n} order${n === 1 ? '' : 's'}`;
                return (
                  <td key={d} className="p-0">
                    <span tabIndex={0} aria-label={label}
                      className={`group relative block h-6 rounded-md outline-none ring-[#8fd3cc] transition hover:ring-2 focus-visible:ring-2 ${STEP[heatLevel(n, data.max)]}`}>
                      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-snow px-2 py-1 text-[11px] font-medium text-[#050505] shadow-lg group-hover:block group-focus-visible:block">
                        {n} order{n === 1 ? '' : 's'} · {d} {slot}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-neutral-500" aria-hidden>
        Fewer {STEP.map((s) => <span key={s} className={`h-2.5 w-2.5 rounded-[3px] ${s}`} />)} More
      </div>
    </div>
  );
}
