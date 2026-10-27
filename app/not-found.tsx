import Link from 'next/link';
import { Compass, Search } from 'lucide-react';

export const metadata = { title: 'Page not found · SokoGlobal', robots: { index: false, follow: true } };

/** 404 for unknown URLs and every notFound() (removed listings, unknown suppliers, orders you can't see). */
export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-4 py-16">
      <div className="card w-full max-w-lg p-8 text-center sm:p-10">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border tone-pending">
          <Compass className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-neutral-500">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">We couldn’t find that page</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          The link may be out of date, or the listing may have been removed by its supplier. Orders and escrow balances are not affected.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/products" className="btn-primary"><Search className="h-4 w-4" aria-hidden /> Browse products</Link>
          <Link href="/" className="btn-secondary">Go to the home page</Link>
        </div>
      </div>
    </main>
  );
}
