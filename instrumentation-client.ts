import * as Sentry from '@sentry/nextjs';
import { DATA_COLLECTION, scrubEvent, sentryDsn, sentryEnvironment, tracesSampleRate } from './lib/monitoring/sentry-options';

const dsn = sentryDsn();

/**
 * Browser Sentry: unhandled errors, failed fetches (as breadcrumbs / spans) and
 * Web Vitals (LCP, INP, CLS, TTFB) through browser tracing. Events go through
 * the same-origin /monitoring tunnel (next.config.ts), so the CSP needs no new host.
 */
Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: sentryEnvironment(),
  tracesSampleRate: tracesSampleRate(),
  dataCollection: DATA_COLLECTION,
  integrations: [Sentry.browserTracingIntegration()],
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
