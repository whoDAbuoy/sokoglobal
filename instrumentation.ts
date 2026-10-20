import * as Sentry from '@sentry/nextjs';

/** Next.js instrumentation hook: start Sentry in the Node and Edge runtimes. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

/** Report errors thrown in Server Components, route handlers, server actions and middleware. */
export const onRequestError = Sentry.captureRequestError;
