'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/** Last-resort error boundary (replaces the root layout when it crashes). Reports to Sentry when configured. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B0F17', color: '#F1F4F9', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#C7CEDB', fontSize: 14, lineHeight: 1.5 }}>
            The error has been reported. Your orders and escrow balances are not affected.
            {error.digest && <><br />Reference: <code>{error.digest}</code></>}
          </p>
          <button type="button" onClick={reset}
            style={{ marginTop: 12, padding: '10px 16px', borderRadius: 6, border: 0, background: '#2563EB', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
