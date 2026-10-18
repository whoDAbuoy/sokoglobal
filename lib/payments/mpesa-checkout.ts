import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/payments/checkout';
import { MpesaError, mpesaConfig, parseStkCallback, stkPush, stkQuery } from '@/lib/payments/mpesa';

type Db = ReturnType<typeof createAdminClient>;

export interface MpesaPaymentRow {
  id: string;
  order_id: string;
  status: 'initiating' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'review';
  checkout_request_id: string | null;
  amount_kes: number;
  result_code: number | null;
  result_desc: string | null;
  callback_payload: unknown;
  created_at: string;
  last_queried_at: string | null;
}

const ROW = 'id, order_id, status, checkout_request_id, amount_kes, result_code, result_desc, callback_payload, created_at, last_queried_at';

/** Daraja callback URL. The secret path segment is the only thing that authenticates a callback. */
export const mpesaCallbackUrl = () => `${siteUrl()}/api/webhooks/daraja/${mpesaConfig().callbackToken}`;

/**
 * Send an STK Push for a pending order. The KES amount is computed in Postgres
 * from the order total (begin_mpesa_payment); the row exists before Daraja is
 * called, so every prompt that reaches a phone has a record.
 */
export async function startMpesaPayment(input: { orderId: string; buyerId: string; phone: string; productTitle: string }) {
  const cfg = mpesaConfig();
  const db = createAdminClient();

  // A previous prompt may have been paid without us hearing back yet — settle
  // it first so we never send a second prompt for an already-paid order.
  await syncOpenPayments(db, input.orderId);

  const { data, error } = await db.rpc('begin_mpesa_payment', {
    p_order_id: input.orderId, p_buyer_id: input.buyerId, p_phone: input.phone,
    p_kes_per_usd: cfg.kesPerUsd, p_max_kes: cfg.maxKes,
  });
  if (error) throw new MpesaError(error.message, 409);
  const payment = data as { id: string; amount_kes: number };

  try {
    const push = await stkPush({
      phone: input.phone,
      amountKes: payment.amount_kes,
      accountReference: `SG${input.orderId.slice(0, 8).toUpperCase()}`,
      description: 'SokoGlobal',
      callbackUrl: mpesaCallbackUrl(),
    }, cfg);
    await db.from('mpesa_payments').update({
      status: 'pending', checkout_request_id: push.checkoutRequestId, merchant_request_id: push.merchantRequestId,
    }).eq('id', payment.id);
    return { paymentId: payment.id, amountKes: payment.amount_kes, customerMessage: push.customerMessage };
  } catch (err) {
    await db.from('mpesa_payments').update({
      status: 'failed', result_desc: (err instanceof Error ? err.message : String(err)).slice(0, 500), completed_at: new Date().toISOString(),
    }).eq('id', payment.id);
    throw err;
  }
}

/**
 * Ask Daraja for the result of a pending payment and settle it. Throttled to
 * one query per payment per 10s (the conditional update doubles as a lock
 * between concurrent pollers). Returns the apply_mpesa_payment outcome, or
 * null if nothing was settled.
 */
export async function syncPayment(db: Db, row: MpesaPaymentRow): Promise<string | null> {
  if (row.status !== 'pending' || !row.checkout_request_id) return null;
  if (Date.now() - Date.parse(row.created_at) < 10_000) return null;   // give the buyer time to enter their PIN

  const cutoff = new Date(Date.now() - 10_000).toISOString();
  const { data: claimed } = await db.from('mpesa_payments')
    .update({ last_queried_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'pending')
    .or(`last_queried_at.is.null,last_queried_at.lt."${cutoff}"`)
    .select('id, callback_payload');
  if (!claimed?.length) return null;

  let result;
  try {
    result = await stkQuery(row.checkout_request_id);
  } catch (err) {
    console.warn('[mpesa] STK query failed — will retry', { id: row.id, err: err instanceof Error ? err.message : err });
    return null;
  }
  if (result.state === 'pending') return null;
  return settle(db, row.checkout_request_id, result.resultCode, result.resultDesc, claimed[0].callback_payload);
}

/** Settle using the confirmed result code; receipt and amount come from the callback, if one arrived. */
export async function settle(db: Db, checkoutRequestId: string, resultCode: number, resultDesc: string, callbackPayload: unknown) {
  const cb = callbackPayload ? parseStkCallback(callbackPayload) : null;
  const { data, error } = await db.rpc('apply_mpesa_payment', {
    p_checkout_request_id: checkoutRequestId,
    p_result_code: resultCode,
    p_result_desc: resultDesc,
    p_receipt: resultCode === 0 ? cb?.receipt ?? null : null,
    p_amount_kes: resultCode === 0 ? cb?.amountKes ?? null : null,
  });
  if (error) throw new Error(`apply_mpesa_payment: ${error.message}`);
  const outcome = String(data);
  if (['amount_mismatch', 'duplicate_payment', 'unknown_reference'].includes(outcome)) {
    console.error('[mpesa] payment needs manual review', { outcome, checkoutRequestId });
  }
  return outcome;
}

/** Settle every open prompt for an order (used before sending a new one). */
export async function syncOpenPayments(db: Db, orderId: string) {
  const { data } = await db.from('mpesa_payments').select(ROW).eq('order_id', orderId).eq('status', 'pending');
  for (const row of (data ?? []) as MpesaPaymentRow[]) await syncPayment(db, row);
}

/** Latest M-Pesa attempt for an order, synced with Daraja if still pending. */
export async function latestPayment(orderId: string): Promise<MpesaPaymentRow | null> {
  const db = createAdminClient();
  const read = async () => {
    const { data } = await db.from('mpesa_payments').select(ROW)
      .eq('order_id', orderId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data as MpesaPaymentRow | null;
  };
  const row = await read();
  if (row && (await syncPayment(db, row))) return read();
  return row;
}
