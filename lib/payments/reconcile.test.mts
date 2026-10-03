// Run: npx tsx --conditions=react-server --test lib/payments/reconcile.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePayouts } from './reconcile.ts';
import { FlutterwaveError } from './flutterwave.ts';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

type Row = Record<string, unknown>;
function payout(over: Row = {}): Row {
  return { id: 'p1', order_id: 'o1', reference: 'payout_o1-1', amount_cents: 31008, currency: 'USD',
    payout_currency: null, payout_amount: null, updated_at: ago(45), flw_transfer_id: null, ...over };
}

/** Minimal fake of the supabase query builder + rpc, recording what was called. */
function fakeDb(noId: Row[], withId: Row[] = []) {
  const rpcCalls: { fn: string; args: Row }[] = [];
  const filters: string[] = [];
  const builder = (rows: () => Row[]) => {
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => { filters.push(`eq:${c}=${v}`); return b; },
      is: (c: string) => { filters.push(`is:${c}`); mode = 'noId'; return b; },
      not: (c: string) => { filters.push(`not:${c}`); mode = 'withId'; return b; },
      lt: (c: string, v: string) => { filters.push(`lt:${c}=${v}`); return b; },
      order: () => b, limit: () => b,
      then: (res: (v: unknown) => void) => res({ data: rows(), error: null }),
    };
    let mode = '';
    const pick = () => (mode === 'withId' ? withId : noId);
    return Object.assign(b, { then: (res: (v: unknown) => void) => res({ data: pick(), error: null }) });
  };
  const db = {
    from: () => builder(() => noId),
    rpc: async (fn: string, args: Row) => { rpcCalls.push({ fn, args }); return { data: fn === 'complete_payout' ? (args.p_success ? 'payout_succeeded' : 'payout_failed') : null, error: null }; },
  };
  return { db: db as any, rpcCalls, filters };
}

const transfer = (over: Row = {}) => ({ id: '190626', reference: 'payout_o1-1', status: 'successful', message: 'Successful', amount: 310.08, currency: 'USD', ...over });

test('found · successful → complete_payout(success) with transfer id', async () => {
  const f = fakeDb([payout()]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => transfer() as any });
  assert.deepEqual(f.rpcCalls, [{ fn: 'complete_payout', args: { p_reference: 'payout_o1-1', p_transfer_id: '190626', p_success: true, p_message: 'Reconciled from Flutterwave: Successful' } }]);
  assert.equal(r.results.reconciled_succeeded, 1);
  assert.ok(f.filters.includes(`lt:updated_at=${ago(30)}`), 'only payouts older than 30 min are considered');
});

test('found · failed → complete_payout(failure) so retry-payouts re-sends', async () => {
  const f = fakeDb([payout()]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => transfer({ status: 'failed', message: 'Account resolve failed' }) as any });
  assert.equal(f.rpcCalls[0].fn, 'complete_payout');
  assert.equal(f.rpcCalls[0].args.p_success, false);
  assert.equal(r.results.reconciled_failed, 1);
});

test('found · pending/new → record transfer id, stay processing', async () => {
  const f = fakeDb([payout()]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => transfer({ status: 'new' }) as any });
  assert.deepEqual(f.rpcCalls, [{ fn: 'finish_payout', args: { p_payout_id: 'p1', p_initiated: true, p_transfer_id: '190626', p_error: null } }]);
  assert.equal(r.results.transfer_id_recorded_pending, 1);
});

test('not found · < 2h old → wait, no DB change', async () => {
  const f = fakeDb([payout({ updated_at: ago(90) })]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => null });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(r.results.not_found_waiting, 1);
});

test('not found · ≥ 2h old → mark failed (safe: no transfer exists)', async () => {
  const f = fakeDb([payout({ updated_at: ago(130) })]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => null });
  assert.equal(f.rpcCalls[0].fn, 'finish_payout');
  assert.equal(f.rpcCalls[0].args.p_initiated, false);
  assert.match(String(f.rpcCalls[0].args.p_error), /no Flutterwave transfer exists/);
  assert.equal(r.results.not_found_marked_failed, 1);
});

test('amount or currency mismatch → untouched, flagged for a human', async () => {
  const f = fakeDb([payout()]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => transfer({ amount: 3100.8 }) as any });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(r.needsHuman.length, 1);
  const f2 = fakeDb([payout()]);
  await reconcilePayouts({ db: f2.db, now: NOW, findTransferByReference: async () => transfer({ currency: 'KES' }) as any });
  assert.equal(f2.rpcCalls.length, 0);
});

test('FX payout compares against the stored local amount', async () => {
  const f = fakeDb([payout({ payout_currency: 'KES', payout_amount: '40124.00' })]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => transfer({ amount: 40124, currency: 'KES' }) as any });
  assert.equal(r.results.reconciled_succeeded, 1);
});

test('Flutterwave lookup error → skipped, retried next run', async () => {
  const f = fakeDb([payout()]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => { throw new FlutterwaveError('Service unavailable', 503); } });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(r.results.lookup_error, 1);
});

test('pass 2: transfer id known but webhook lost → settle from GET /transfers/:id', async () => {
  const f = fakeDb([], [payout({ flw_transfer_id: '190626', updated_at: ago(400) })]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => null,
    getTransfer: async () => ({ id: '190626', reference: 'payout_o1-1', status: 'successful', message: 'ok' }) });
  assert.equal(f.rpcCalls[0].fn, 'complete_payout');
  assert.equal(r.results.reconciled_succeeded, 1);
});

test('pass 2: reference mismatch → flagged, untouched', async () => {
  const f = fakeDb([], [payout({ flw_transfer_id: '190626', updated_at: ago(400) })]);
  const r = await reconcilePayouts({ db: f.db, now: NOW, findTransferByReference: async () => null,
    getTransfer: async () => ({ id: '190626', reference: 'payout_OTHER-1', status: 'successful', message: 'ok' }) });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(r.needsHuman.length, 1);
});

test('time budget exhausted → defers remaining items', async () => {
  const f = fakeDb([payout(), payout({ id: 'p2', reference: 'payout_o2-1' })]);
  let calls = 0;
  const r = await reconcilePayouts({ db: f.db, now: NOW, hasTime: () => calls++ < 1, findTransferByReference: async () => transfer() as any });
  assert.equal(r.results.reconciled_succeeded, 1);
  assert.equal(r.results.deferred_out_of_time, 1);
});
