/**
 * Instant placeholder for a portal page while its data streams in (used by the route segments'
 * loading.tsx). Server-rendered, no client JS: the same header bar height as DashboardHeader,
 * a page title and a grid of card blocks, so the layout doesn't jump when the real page arrives.
 * Screen readers hear one "Loading" status; the shapes themselves are hidden from them.
 */
export default function PageSkeleton({ cards = 6, label = 'Loading' }: { cards?: number; label?: string }) {
  const block = 'rounded-2xl bg-neutral-900/[0.06] dark:bg-snow/[0.06] motion-safe:animate-pulse';
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div aria-hidden>
        <div className="glass-nav">
          <div className="mx-auto flex h-14 w-full max-w-[1920px] items-center justify-between gap-3 px-3 sm:h-16 sm:px-8 lg:px-12">
            <div className={`${block} h-7 w-32 rounded-full`} />
            <div className="hidden gap-2 md:flex">
              {Array.from({ length: 5 }, (_, i) => <div key={i} className={`${block} h-7 w-20 rounded-full`} />)}
            </div>
            <div className={`${block} h-8 w-8 rounded-full`} />
          </div>
        </div>
        <div className="page-wide py-10">
          <div className={`${block} h-3 w-24`} />
          <div className={`${block} mt-3 h-8 w-72 max-w-full`} />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: cards }, (_, i) => <div key={i} className={`${block} h-44`} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
