import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthorizedCron } from '@/lib/cron';
import { readIntegrationConfig } from '@/lib/integrations/config';
import { INTEGRATION_TARGETS } from '@/lib/integrations/events';
import { drainIntegrationOutbox } from '@/lib/integrations/outbox';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from '@/lib/integrations/signature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Integration bridge: sends queued platform events (integration_outbox, migration 033) to n8n
 * as signed webhooks, and to Twenty CRM (lib/services/crm-sync.ts).
 *
 *   GET  /api/v1/webhooks/n8n   Authorization: Bearer CRON_SECRET (Vercel Cron; daily safety net, also purges rows > 30 days)
 *   POST /api/v1/webhooks/n8n   signed by n8n (a Schedule Trigger every minute gives near-instant alerts):
 *        X-SokoGlobal-Timestamp: <unix seconds>
 *        X-SokoGlobal-Signature: sha256=<hex HMAC-SHA256(N8N_WEBHOOK_SECRET, `${timestamp}.${rawBody}`)>
 *        body (JSON, optional): { "targets": ["n8n", "twenty"], "limit": 1–500 }
 *      Bearer CRON_SECRET is accepted on POST too.
 *
 * Deliveries to n8n carry the same two headers, signed with the same secret, plus
 * X-SokoGlobal-Event and X-SokoGlobal-Delivery (stable per event, for de-duplication).
 */
const MAX_BODY_BYTES = 4096;
const drainRequest = z.strictObject({
  targets: z.array(z.enum(INTEGRATION_TARGETS)).min(1).max(INTEGRATION_TARGETS.length).optional(),
  limit: z.int().min(1).max(500).optional(),
});

async function drain(targets?: (typeof INTEGRATION_TARGETS)[number][], limit?: number, purge = false) {
  try {
    const result = await drainIntegrationOutbox({ targets, limit, budgetMs: 45_000, purge });
    if (!result.configured.length) console.warn('[integrations] no target configured (N8N_WEBHOOK_URL / TWENTY_API_URL)');
    if (result.problems.length) console.warn('[integrations] configuration problems', result.problems);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[integrations] drain failed', err);
    return NextResponse.json({ error: 'Integration dispatch failed' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return drain(undefined, undefined, true);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

  if (!isAuthorizedCron(request)) {
    const check = verifySignature(readIntegrationConfig().n8n?.secret, {
      signature: request.headers.get(SIGNATURE_HEADER), timestamp: request.headers.get(TIMESTAMP_HEADER),
    }, raw);
    if (!check.ok) {
      if (check.reason === 'not_configured') console.warn('[integrations] signed call refused: N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let json: unknown = {};
  if (raw.trim()) {
    try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }); }
  }
  const body = drainRequest.safeParse(json);
  if (!body.success) return NextResponse.json({ error: 'Invalid request', issues: z.flattenError(body.error).fieldErrors }, { status: 422 });
  return drain(body.data.targets, body.data.limit);
}
