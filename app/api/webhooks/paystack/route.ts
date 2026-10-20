/**
 * POST /api/webhooks/paystack — alias of /api/webhooks/card, so either URL can be
 * set in Paystack → Settings → API Keys & Webhooks. Same handler: signature check
 * (x-paystack-signature), re-verify, apply_card_payment(), idempotent.
 */
export { POST } from '../card/route';

// Route segment config must be declared literally in each route file.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
