import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { readIntegrationConfig, type IntegrationConfig } from '@/lib/integrations/config';
import {
  buildN8nEnvelope, contactRow, n8nContactIds, parseCrmEvent, parseN8nEvent, partyUrl, toRecipient,
  type IntegrationTarget, type N8nEvent, type Recipient,
} from '@/lib/integrations/events';
import { signedHeaders } from '@/lib/integrations/signature';
import { createTwentyClient, syncCrmEvent, TwentyError, type LinkStore } from '@/lib/services/crm-sync';

/**
 * Drains integration_outbox (migration 033): claim → validate → deliver → finish.
 * n8n gets one signed POST per event; Twenty gets REST calls via lib/services/crm-sync.
 * Leases (SKIP LOCKED) make overlapping runs safe. A target whose env isn't configured is left alone:
 * its rows wait until it is.
 */
type OutboxRow = { id: number; target: IntegrationTarget; event_type: string; payload: unknown; attempts: number; created_at: string };
type Outcome = 'sent' | 'skipped' | 'retry' | 'failed';
export type DrainStats = Record<Outcome, number>;
export interface DrainResult { configured: IntegrationTarget[]; problems: string[]; purged: number; results: Partial<Record<IntegrationTarget, DrainStats>> }

const MAX_ATTEMPTS = 8;   // finish_integration_event() makes the 8th failure final

class DeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

// ── n8n ─────────────────────────────────────────────────────────────────────

async function recipientsFor(db: SupabaseClient, event: N8nEvent, site: string): Promise<Recipient[]> {
  if (event.type === 'rfq.created') {
    const { data, error } = await db.rpc('rfq_supplier_recipients', { p_rfq_id: event.data.rfq_id });
    if (error) throw new DeliveryError(`rfq_supplier_recipients: ${error.message}`, true);
    return ((data ?? []) as unknown[]).flatMap((r) => {
      const row = contactRow.safeParse(r);
      const rec = row.success ? toRecipient(row.data, 'supplier', partyUrl(event, 'supplier', site)) : null;
      return rec ? [rec] : [];
    });
  }
  const ids = n8nContactIds(event);
  const all = [...ids.supplier, ...ids.buyer];
  if (!all.length) return [];
  const { data, error } = await db.rpc('integration_contacts', { p_ids: all });
  if (error) throw new DeliveryError(`integration_contacts: ${error.message}`, true);
  return ((data ?? []) as unknown[]).flatMap((r) => {
    const row = contactRow.safeParse(r);
    if (!row.success || !row.data.id) return [];
    const party: Recipient['party'] = ids.buyer.includes(row.data.id) ? 'buyer' : 'supplier';
    const rec = toRecipient(row.data, party, partyUrl(event, party, site));
    return rec ? [rec] : [];
  });
}

async function deliverToN8n(db: SupabaseClient, cfg: NonNullable<IntegrationConfig['n8n']>, row: OutboxRow, site: string): Promise<Outcome> {
  const parsed = parseN8nEvent(row.event_type, row.payload);
  if (!parsed.ok) throw new DeliveryError(parsed.error, false);
  const recipients = await recipientsFor(db, parsed.event, site);
  if (!recipients.length) return 'skipped';   // e.g. no supplier lists in that category yet

  const body = JSON.stringify(buildN8nEnvelope(row, parsed.event, recipients));
  let res: Response;
  try {
    res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SokoGlobal-Event': row.event_type, 'X-SokoGlobal-Delivery': `evt_${row.id}`, ...signedHeaders(cfg.secret, body) },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new DeliveryError(`n8n unreachable: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  // Any non-2xx retries: a 404 usually means the n8n workflow is inactive, which an operator can fix.
  if (!res.ok) throw new DeliveryError(`n8n responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, true);
  return 'sent';
}

// ── Twenty ──────────────────────────────────────────────────────────────────

function linkStore(db: SupabaseClient): LinkStore {
  return {
    async get(key) {
      const { data, error } = await db.from('crm_links').select('crm_id').eq('link_key', key).maybeSingle<{ crm_id: string }>();
      if (error) throw new DeliveryError(`crm_links read: ${error.message}`, true);
      return data?.crm_id ?? null;
    },
    async set(key, crmId) {
      const { error } = await db.from('crm_links').upsert({ link_key: key, crm_id: crmId });
      if (error) throw new DeliveryError(`crm_links write: ${error.message}`, true);
    },
  };
}

async function deliverToTwenty(deps: Parameters<typeof syncCrmEvent>[1], row: OutboxRow): Promise<Outcome> {
  const parsed = parseCrmEvent(row.event_type, row.payload);
  if (!parsed.ok) throw new DeliveryError(parsed.error, false);
  return syncCrmEvent(parsed.event, deps);
}

// ── Drain ───────────────────────────────────────────────────────────────────

/** `purge` drops rows older than 30 days first (the daily cron does it, configured or not, so the table stays bounded). */
export async function drainIntegrationOutbox(opts: { targets?: IntegrationTarget[]; limit?: number; budgetMs?: number; purge?: boolean } = {}): Promise<DrainResult> {
  const config = readIntegrationConfig();
  const configured = (['n8n', 'twenty'] as const).filter((t) => config[t]);
  const wanted = configured.filter((t) => !opts.targets || opts.targets.includes(t));
  const result: DrainResult = { configured: [...configured], problems: config.problems, purged: 0, results: {} };
  if (opts.purge) {
    const { data, error } = await createAdminClient().rpc('purge_integration_outbox', { p_days: 30 });
    if (error) console.error('[integrations] purge failed', error.message);
    result.purged = typeof data === 'number' ? data : 0;
  }
  if (!wanted.length) return result;

  const db = createAdminClient();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokoglobal.com').replace(/\/+$/, '');
  const end = Date.now() + (opts.budgetMs ?? 45_000);
  const twentyDeps = config.twenty
    ? { twenty: createTwentyClient({ baseUrl: config.twenty.baseUrl, apiKey: config.twenty.apiKey }), links: linkStore(db) }
    : null;

  for (const target of wanted) {
    const stats: DrainStats = { sent: 0, skipped: 0, retry: 0, failed: 0 };
    result.results[target] = stats;
    let remaining = opts.limit ?? 200;
    while (remaining > 0 && Date.now() < end) {
      // Small CRM batches: each Twenty event is several sequential calls, and claimed rows are leased for 5 minutes.
      const { data, error } = await db.rpc('claim_integration_events', { p_target: target, p_limit: Math.min(remaining, target === 'n8n' ? 25 : 5) });
      if (error) { console.error('[integrations] claim failed', target, error.message); break; }
      const rows = (data ?? []) as OutboxRow[];
      if (!rows.length) break;
      remaining -= rows.length;
      // Twenty rows run one at a time so two events for the same buyer never race to create them twice.
      const handle = async (row: OutboxRow) => {
        let outcome: Outcome;
        let message: string | null = null;
        try {
          outcome = target === 'n8n' ? await deliverToN8n(db, config.n8n!, row, site) : await deliverToTwenty(twentyDeps!, row);
        } catch (err) {
          const retryable = err instanceof DeliveryError || err instanceof TwentyError ? err.retryable : true;
          message = err instanceof Error ? err.message : String(err);
          outcome = retryable ? 'retry' : 'failed';
          console.error('[integrations] delivery failed', { id: row.id, target, type: row.event_type, attempt: row.attempts, message });
        }
        const { error: finishError } = await db.rpc('finish_integration_event', { p_id: row.id, p_outcome: outcome, p_error: message });
        if (finishError) console.error('[integrations] finish failed', row.id, finishError.message);
        stats[outcome === 'retry' && row.attempts >= MAX_ATTEMPTS ? 'failed' : outcome] += 1;
      };
      if (target === 'n8n') await Promise.all(rows.map(handle));
      else for (const row of rows) await handle(row);
    }
  }
  return result;
}
