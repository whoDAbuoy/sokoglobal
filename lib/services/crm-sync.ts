import { unitPriceForQuantity } from '../rfq';
import type { CrmEvent } from '../integrations/events';

/**
 * Twenty CRM bridge: maps SokoGlobal buyer ↔ supplier interactions onto Twenty's standard
 * objects through its REST API (Twenty v2.46, `Authorization: Bearer <API key>`).
 *
 *   supplier            → Company   (link "company:supplier:<id>")
 *   buyer               → Company + Person (point of contact)
 *   RFQ for a listing   → Opportunity, stage NEW, in that supplier's pipeline
 *   supplier's quote    → the same Opportunity moved NEW → PROPOSAL (created if new)
 *   product inquiry     → Opportunity, stage NEW
 *   profile view        → Note on the supplier and the buyer
 *
 * A supplier's pipeline is the opportunities whose company is that supplier. Record ids are kept
 * in crm_links (LinkStore), so each entity is created once. Buyers' emails and phone numbers are
 * never sent: deals stay on the platform, where escrow protects both sides.
 */

export const STAGE = { new: 'NEW', proposal: 'PROPOSAL' } as const;

export class TwentyError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export interface TwentyClient {
  create(objectPlural: string, body: Record<string, unknown>): Promise<string>;
  update(objectPlural: string, id: string, body: Record<string, unknown>): Promise<void>;
  findOne(objectPlural: string, id: string): Promise<Record<string, unknown> | null>;
}

export interface LinkStore {
  get(key: string): Promise<string | null>;
  set(key: string, crmId: string): Promise<void>;
}

/** Network errors, timeouts, 5xx, 408, 429, and auth errors (an operator can fix the key) retry; other 4xx won't. */
const retryableStatus = (s: number) => s >= 500 || s === 408 || s === 429 || s === 401 || s === 403;

/** First record in a Twenty REST response: { data: { createCompany: {…} } } / { data: { company: {…} } }. */
function firstRecord(body: unknown): Record<string, unknown> | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  for (const v of Object.values(data)) if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function createTwentyClient(opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): TwentyClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const call = async (method: string, path: string, body?: Record<string, unknown>) => {
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/rest/${path}`, {
        method,
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new TwentyError(`Twenty unreachable: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const json = await res.json().catch(() => null) as unknown;
    if (method === 'GET' && res.status === 404) return null;
    if (!res.ok) {
      const msg = (json as { messages?: string[]; error?: string } | null)?.messages?.join('; ') ?? (json as { error?: string } | null)?.error ?? 'request failed';
      throw new TwentyError(`Twenty ${method} ${path.split('/')[0]} → ${res.status}: ${String(msg).slice(0, 300)}`, retryableStatus(res.status));
    }
    return json;
  };
  return {
    async create(objectPlural, body) {
      const id = firstRecord(await call('POST', objectPlural, body))?.id;
      if (typeof id !== 'string') throw new TwentyError(`Twenty POST ${objectPlural}: no id in response`, false);
      return id;
    },
    async update(objectPlural, id, body) { await call('PATCH', `${objectPlural}/${encodeURIComponent(id)}`, body); },
    async findOne(objectPlural, id) { return firstRecord(await call('GET', `${objectPlural}/${encodeURIComponent(id)}`)); },
  };
}

// ── Mapping ─────────────────────────────────────────────────────────────────

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

/** KES value as Twenty's currency field, or nothing when it can't be represented exactly. */
export function kesAmount(kes: number | null | undefined): { amount: { amountMicros: number; currencyCode: 'KES' } } | Record<string, never> {
  if (kes == null || !Number.isFinite(kes) || kes <= 0) return {};
  const micros = Math.round(kes * 1_000_000);
  return Number.isSafeInteger(micros) ? { amount: { amountMicros: micros, currencyCode: 'KES' } } : {};
}

interface Deps { twenty: TwentyClient; links: LinkStore }

async function ensure(deps: Deps, key: string, create: () => Promise<string>): Promise<string> {
  const existing = await deps.links.get(key);
  if (existing) return existing;
  const id = await create();
  await deps.links.set(key, id);
  return id;
}

const supplierCompany = (deps: Deps, d: { supplier_id: string; supplier_company: string }) =>
  ensure(deps, `company:supplier:${d.supplier_id}`, () => deps.twenty.create('companies', { name: d.supplier_company }));

async function buyerContact(deps: Deps, d: { buyer_id: string; buyer_name: string; buyer_company: string; buyer_country: string }) {
  const companyId = await ensure(deps, `company:buyer:${d.buyer_id}`,
    () => deps.twenty.create('companies', { name: `${d.buyer_company} (${d.buyer_country})` }));
  return ensure(deps, `person:buyer:${d.buyer_id}`,
    () => deps.twenty.create('people', { name: splitName(d.buyer_name), companyId }));
}

export type SyncOutcome = 'sent' | 'skipped';

export async function syncCrmEvent(event: CrmEvent, deps: Deps): Promise<SyncOutcome> {
  switch (event.type) {
    case 'rfq.created': {
      const d = event.data;
      const key = `opportunity:rfq:${d.rfq_id}:${d.supplier_id}`;
      if (await deps.links.get(key)) return 'skipped';
      const [companyId, pointOfContactId] = [await supplierCompany(deps, d), await buyerContact(deps, d)];
      await ensure(deps, key, () => deps.twenty.create('opportunities', {
        name: `RFQ: ${d.title}`, stage: STAGE.new, companyId, pointOfContactId, closeDate: d.expires_at,
        ...kesAmount(d.target_price_kes != null ? d.target_price_kes * d.quantity : null),
      }));
      return 'sent';
    }
    case 'rfq.quote_submitted': {
      const d = event.data;
      const quantity = Math.max(d.quantity, d.moq);
      const value = kesAmount(unitPriceForQuantity(d.unit_price_kes, d.price_tiers, quantity) * quantity);
      const key = `opportunity:rfq:${d.rfq_id}:${d.supplier_id}`;
      const existing = await deps.links.get(key);
      if (existing) {
        // Only move it forward from where we put it; never undo a stage someone set by hand.
        const current = await deps.twenty.findOne('opportunities', existing);
        if (current && current.stage !== STAGE.new) return 'skipped';
        if (current) { await deps.twenty.update('opportunities', existing, { stage: STAGE.proposal, ...value }); return 'sent'; }
      }
      const [companyId, pointOfContactId] = [await supplierCompany(deps, d), await buyerContact(deps, d)];
      const id = await deps.twenty.create('opportunities', {
        name: `RFQ: ${d.title}`, stage: STAGE.proposal, companyId, pointOfContactId, closeDate: d.valid_until, ...value,
      });
      await deps.links.set(key, id);
      return 'sent';
    }
    case 'lead.inquiry_created': {
      const d = event.data;
      const key = `opportunity:inquiry:${d.thread_id}`;
      if (await deps.links.get(key)) return 'skipped';
      const [companyId, pointOfContactId] = [await supplierCompany(deps, d), await buyerContact(deps, d)];
      await ensure(deps, key, () => deps.twenty.create('opportunities', {
        name: `Inquiry: ${d.product_title ?? 'listing'}`, stage: STAGE.new, companyId, pointOfContactId,
      }));
      return 'sent';
    }
    case 'supplier.profile_viewed': {
      const d = event.data;
      const [companyId, personId] = [await supplierCompany(deps, d), await buyerContact(deps, d)];
      // Each step is linked, so a retry after a partial failure resumes instead of duplicating the note.
      const key = `note:profile_view:${d.supplier_id}:${d.buyer_id}:${d.viewed_on}`;
      const noteId = await ensure(deps, key,
        () => deps.twenty.create('notes', { title: `Profile viewed by ${d.buyer_company} (${d.buyer_country}) on ${d.viewed_on}` }));
      await ensure(deps, `${key}:company`, () => deps.twenty.create('noteTargets', { noteId, targetCompanyId: companyId }));
      await ensure(deps, `${key}:person`, () => deps.twenty.create('noteTargets', { noteId, targetPersonId: personId }));
      return 'sent';
    }
  }
}
