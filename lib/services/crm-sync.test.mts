// Run: npx tsx --test lib/services/crm-sync.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwentyClient, kesAmount, splitName, syncCrmEvent, TwentyError, type LinkStore, type TwentyClient } from './crm-sync.ts';
import { parseCrmEvent, type CrmEvent } from '../integrations/events.ts';

const SUPPLIER = 'e3311111-1111-4111-8111-111111111111';
const BUYER = 'e3322222-2222-4222-8222-222222222222';
const RFQ = 'e3300000-0000-4000-8000-000000000001';
const who = { supplier_id: SUPPLIER, supplier_company: 'Sup Co', buyer_id: BUYER, buyer_name: 'Jane Wanjiru Doe', buyer_company: 'Buyer Co', buyer_country: 'KE' };

function event(type: string, payload: object): CrmEvent {
  const r = parseCrmEvent(type, payload);
  if (!r.ok) throw new Error(r.error);
  return r.event;
}

/** In-memory Twenty + link store that records every call. */
function fakes() {
  const calls: { op: string; object: string; id?: string; body?: Record<string, unknown> }[] = [];
  const records = new Map<string, Record<string, unknown>>();
  let n = 0;
  const twenty: TwentyClient = {
    async create(object, body) { const id = `${object}-${++n}`; records.set(id, { id, ...body }); calls.push({ op: 'create', object, body }); return id; },
    async update(object, id, body) { records.set(id, { ...records.get(id), ...body }); calls.push({ op: 'update', object, id, body }); },
    async findOne(object, id) { calls.push({ op: 'find', object, id }); return records.get(id) ?? null; },
  };
  const map = new Map<string, string>();
  const links: LinkStore = { async get(k) { return map.get(k) ?? null; }, async set(k, v) { map.set(k, v); } };
  return { twenty, links, calls, records, map };
}

const rfqCreated = event('rfq.created', {
  rfq_id: RFQ, title: 'Kettles', quantity: 500, target_price_kes: 900, delivery_location: 'Nairobi', product_id: RFQ,
  created_at: '2026-10-26T09:00:00+00:00', expires_at: '2026-11-09T09:00:00+00:00', ...who,
});
const quote = event('rfq.quote_submitted', {
  rfq_id: RFQ, quote_id: 'e3300000-0000-4000-8000-0000000000a1', title: 'Kettles', quantity: 500,
  unit_price_kes: 850, price_tiers: [{ min_qty: 400, unit_price_kes: 800 }], moq: 100,
  valid_until: '2026-11-02T00:00:00+00:00', created_at: '2026-10-27T00:00:00+00:00', ...who,
});

test('splitName and kesAmount', () => {
  assert.deepEqual(splitName('  Jane  Wanjiru Doe '), { firstName: 'Jane', lastName: 'Wanjiru Doe' });
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
  assert.deepEqual(kesAmount(450_000), { amount: { amountMicros: 450_000_000_000, currencyCode: 'KES' } });
  assert.deepEqual(kesAmount(null), {});
  assert.deepEqual(kesAmount(0), {});
  assert.deepEqual(kesAmount(1e12), {}, 'beyond a safe integer of micros: no amount rather than a wrong one');
});

test('RFQ for a listing: supplier company, buyer company + person, NEW opportunity in the supplier pipeline', async () => {
  const f = fakes();
  assert.equal(await syncCrmEvent(rfqCreated, f), 'sent');
  assert.deepEqual(f.calls.map((c) => c.object), ['companies', 'companies', 'people', 'opportunities']);
  assert.deepEqual(f.calls[0].body, { name: 'Sup Co' });
  assert.deepEqual(f.calls[1].body, { name: 'Buyer Co (KE)' });
  assert.deepEqual(f.calls[2].body, { name: { firstName: 'Jane', lastName: 'Wanjiru Doe' }, companyId: 'companies-2' });
  assert.deepEqual(f.calls[3].body, {
    name: 'RFQ: Kettles', stage: 'NEW', companyId: 'companies-1', pointOfContactId: 'people-3', closeDate: '2026-11-09T09:00:00+00:00',
    amount: { amountMicros: 450_000_000_000, currencyCode: 'KES' },
  });
  const json = JSON.stringify(f.calls);
  assert.ok(!json.includes('@') && !json.includes('+254'), 'no buyer email or phone leaves the platform');

  assert.equal(await syncCrmEvent(rfqCreated, f), 'skipped', 'replays are no-ops');
  assert.equal(f.calls.length, 4);
});

test('a quote moves the NEW opportunity to PROPOSAL with the quoted value (tier price at the ordered quantity)', async () => {
  const f = fakes();
  await syncCrmEvent(rfqCreated, f);
  assert.equal(await syncCrmEvent(quote, f), 'sent');
  const update = f.calls.find((c) => c.op === 'update');
  assert.deepEqual(update, { op: 'update', object: 'opportunities', id: 'opportunities-4', body: { stage: 'PROPOSAL', amount: { amountMicros: 400_000_000_000, currencyCode: 'KES' } } });
});

test('a quote never moves an opportunity someone already advanced by hand', async () => {
  const f = fakes();
  await syncCrmEvent(rfqCreated, f);
  f.records.set('opportunities-4', { ...f.records.get('opportunities-4'), stage: 'MEETING' });
  assert.equal(await syncCrmEvent(quote, f), 'skipped');
  assert.ok(!f.calls.some((c) => c.op === 'update'));
});

test('a quote on a category RFQ creates the opportunity at PROPOSAL, reusing known companies and people', async () => {
  const f = fakes();
  f.map.set(`company:supplier:${SUPPLIER}`, 'companies-existing');
  assert.equal(await syncCrmEvent(quote, f), 'sent');
  assert.deepEqual(f.calls.map((c) => `${c.op}:${c.object}`), ['create:companies', 'create:people', 'create:opportunities']);
  assert.equal(f.calls[2].body?.stage, 'PROPOSAL');
  assert.equal(f.calls[2].body?.companyId, 'companies-existing');
  assert.equal(f.map.get(`opportunity:rfq:${RFQ}:${SUPPLIER}`), 'opportunities-3');
});

test('inquiries open a NEW opportunity once; profile views add a note on both records, resumable after a partial failure', async () => {
  const f = fakes();
  const inquiry = event('lead.inquiry_created', { thread_id: RFQ, product_title: 'Kettle', ...who, created_at: '2026-10-26T09:00:00+00:00' });
  assert.equal(await syncCrmEvent(inquiry, f), 'sent');
  assert.equal(f.calls.at(-1)?.body?.name, 'Inquiry: Kettle');
  assert.equal(await syncCrmEvent(inquiry, f), 'skipped');

  const view = event('supplier.profile_viewed', { ...who, viewed_on: '2026-10-26' });
  const realCreate = f.twenty.create;
  let failNext = true;
  f.twenty.create = async (object, body) => {
    if (object === 'noteTargets' && body.targetPersonId && failNext) { failNext = false; throw new TwentyError('boom', true); }
    return realCreate(object, body);
  };
  await assert.rejects(syncCrmEvent(view, f), /boom/);
  assert.equal(await syncCrmEvent(view, f), 'sent');
  const notes = f.calls.filter((c) => c.object === 'notes');
  const targets = f.calls.filter((c) => c.object === 'noteTargets');
  assert.equal(notes.length, 1, 'the retry reuses the note');
  assert.deepEqual(notes[0].body, { title: 'Profile viewed by Buyer Co (KE) on 2026-10-26' });
  assert.deepEqual(targets.map((t) => Object.keys(t.body ?? {}).sort().join(',')), ['noteId,targetCompanyId', 'noteId,targetPersonId']);
});

test('REST client: bearer auth, response parsing, 404 on find, retryable vs permanent errors', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const queue: Response[] = [
    reply(201, { data: { createCompany: { id: 'c-1', name: 'Sup Co' } } }),
    reply(200, { data: { opportunity: { id: 'o-1', stage: 'NEW' } } }),
    reply(404, { error: 'not found' }),
    reply(400, { messages: ['stage must be one of NEW, …'] }),
    reply(503, { error: 'down' }),
  ];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return queue.shift()!; }) as unknown as typeof fetch;
  const client = createTwentyClient({ baseUrl: 'https://crm.example.com', apiKey: 'key-123', fetchImpl });

  assert.equal(await client.create('companies', { name: 'Sup Co' }), 'c-1');
  assert.equal(seen[0].url, 'https://crm.example.com/rest/companies');
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer key-123');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(await client.findOne('opportunities', 'o-1'), { id: 'o-1', stage: 'NEW' });
  assert.equal(await client.findOne('opportunities', 'gone'), null);
  await assert.rejects(client.update('opportunities', 'o-1', { stage: 'X' }), (e: TwentyError) => e.retryable === false && /400: stage must be/.test(e.message));
  await assert.rejects(client.create('people', {}), (e: TwentyError) => e.retryable === true && /503/.test(e.message));

  const offline = createTwentyClient({ baseUrl: 'https://crm.example.com', apiKey: 'k', fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  await assert.rejects(offline.create('companies', {}), (e: TwentyError) => e.retryable && /unreachable/.test(e.message));
});
