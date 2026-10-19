import * as Sentry from '@sentry/nextjs';
import { DATA_COLLECTION, scrubEvent, sentryDsn, sentryEnvironment, tracesSampleRate } from './lib/monitoring/sentry-options';

const dsn = sentryDsn();

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: sentryEnvironment(),
  tracesSampleRate: tracesSampleRate(),
  dataCollection: DATA_COLLECTION,
  beforeSend: (event) => scrubEvent(event),
});
