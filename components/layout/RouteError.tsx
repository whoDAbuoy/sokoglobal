'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Error boundary body for app/error.tsx and the portal segments (dashboard, supplier, admin), so a crash in
 * one page keeps the site header or portal navigation around it. Reports to Sentry when configured.
 */
export default function RouteError({ error, reset, home = '/' }: { error: Error & { digest?: string }; reset: () => void; home?: string }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div role="alert" className="grid min-h-[60vh] place-items-center px-4 py-16">
      <div className="card w-full max-w-lg p-8 text-center sm:p-10">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border tone-pending">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">Something went wrong</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          This page hit an error and it has been reported. Your orders and escrow balances are not affected.
        </p>
        {error.digest && <p className="mt-2 text-xs text-neutral-500">Reference: <code className="font-mono">{error.digest}</code></p>}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={reset} className="btn-primary"><RotateCcw className="h-4 w-4" aria-hidden /> Try again</button>
          <Link href={home} className="btn-secondary">Back to {home === '/' ? 'the home page' : 'your dashboard'}</Link>
        </div>
      </div>
    </div>
  );
}
