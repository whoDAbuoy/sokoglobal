import * as Sentry from '@sentry/nextjs';
import { DATA_COLLECTION, scrubEvent, sentryDsn, sentryEnvironment, tracesSampleRate } from './lib/monitoring/sentry-options';

const dsn = sentryDsn();

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: sentryEnvironment(),
  tracesSampleRate: tracesSampleRate(),
  dataCollection: DATA_COLLECTION,
  // Existing server code reports handled failures (webhooks, payouts, crons) with console.error —
  // forward those to Sentry too, without touching the payment code paths.
  integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubEvent(event),
});
