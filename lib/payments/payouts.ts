import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  centsToMajor, createTransfer, FlutterwaveError, getTransferRate, type PayoutAccount,
} from '@/lib/payments/flutterwave';
import { planFxPayout, type FxPlan } from '@/lib/payments/fx';

export type PayoutResult =
  | { action: 'initiated'; payoutId: string; transferId: string; payoutCurrency: string; payoutAmount: number }
  | { action: 'pending_reconciliation'; payoutId: string; reason: string }
  | { action: 'failed'; payoutId: string; reason: string }
  | { action: 'hold'; payoutId?: string; reason: string }
  | { action: 'skip'; payoutId?: string; status: string };

type Claim =
  | { action: 'transfer'; payout_id: string; reference: string; amount_cents: number; currency: string; account: PayoutAccount }
  | { action: 'hold'; payout_id?: string; reason: string }
  | { action: 'skip'; payout_id?: string; status: string };

/** Platform commission on the goods value, in basis points (500 = 5%). */
const feeBps = () => {
  const n = Number.parseInt(process.env.PLATFORM_FEE_BPS ?? '0', 10);
  return Number.isFinite(n) && n >= 0 && n <= 3000 ? n : 0;
};

/**
 * Pay the supplier for a released order. Idempotent and safe to retry:
 *
 *  1. begin_payout() — row-locked claim; decrypts the account number from
 *     Supabase Vault (service role only); returns hold/skip when not ready.
 *  2. Same currency (USD → USD): amount = net cents / 100.
 *     Different currency (USD → KES/NGN/GHS/EUR…): GET /transfers/rates
 *     two-pass quote (lib/payments/fx.ts), recorded via record_payout_fx(),
 *     which refuses any quote debiting more than the net USD.
 *  3. POST /transfers in the payout currency with debit_currency = USD and a
 *     reference unique to this attempt; finish_payout() writes the transfer id
 *     to payouts + escrow_events.
 *
 * Failures BEFORE the transfer call (FX quote) are safe to retry. Ambiguous
 * failures OF the transfer call (timeout/5xx) are left 'processing' and raised
 * to Slack by the retry cron — retrying could pay twice.
 */
export async function processPayout(orderId: string): Promise<PayoutResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc('begin_payout', { p_order_id: orderId, p_fee_bps: feeBps() });
  if (error) throw new Error(`begin_payout failed: ${error.message}`);
  const claim = data as Claim;

  if (claim.action === 'hold') return { action: 'hold', payoutId: claim.payout_id, reason: claim.reason };
  if (claim.action === 'skip') return { action: 'skip', payoutId: claim.payout_id, status: claim.status };

  const debitCurrency = claim.currency;             // escrow currency (USD)
  const payoutCurrency = claim.account.currency;    // supplier's account currency
  let amountMajor = centsToMajor(claim.amount_cents);
  let fx: FxPlan | null = null;

  if (payoutCurrency !== debitCurrency) {
    try {
      fx = await planFxPayout(claim.amount_cents, async (destinationAmount) =>
        getTransferRate({ amount: destinationAmount, destinationCurrency: payoutCurrency, sourceCurrency: debitCurrency }));
      const { error: fxError } = await db.rpc('record_payout_fx', {
        p_payout_id: claim.payout_id, p_currency: payoutCurrency, p_amount: fx.destinationAmount,
        p_rate: fx.rate, p_source_cents: fx.sourceCents,
      });
      if (fxError) throw new Error(fxError.message);
      amountMajor = fx.destinationAmount;
    } catch (err) {
      // Nothing has been sent — marking failed lets the retry cron re-quote later.
      const reason = `FX quote failed: ${err instanceof Error ? err.message : String(err)}`;
      await db.rpc('finish_payout', { p_payout_id: claim.payout_id, p_initiated: false, p_transfer_id: null, p_error: reason });
      return { action: 'failed', payoutId: claim.payout_id, reason };
    }
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    const transfer = await createTransfer({
      reference: claim.reference,
      amountMajor,
      currency: payoutCurrency,
      debitCurrency,
      narration: `SokoGlobal payout · order ${orderId.slice(0, 8).toUpperCase()}`,
      account: claim.account,
      callbackUrl: site ? `${site}/api/webhooks/flutterwave` : undefined,
    });
    const { error: finishError } = await db.rpc('finish_payout', {
      p_payout_id: claim.payout_id, p_initiated: true, p_transfer_id: transfer.id, p_error: null,
    });
    if (finishError) console.error('[payout] transfer created but not recorded', { orderId, transferId: transfer.id, finishError });
    return { action: 'initiated', payoutId: claim.payout_id, transferId: transfer.id, payoutCurrency, payoutAmount: amountMajor };
  } catch (err) {
    const fw = err instanceof FlutterwaveError ? err : null;
    const reason = err instanceof Error ? err.message : 'Unknown transfer error';
    if (!fw || fw.retryable) {
      console.error('[payout] ambiguous transfer outcome — left processing for reconciliation', { orderId, reason });
      return { action: 'pending_reconciliation', payoutId: claim.payout_id, reason };
    }
    await db.rpc('finish_payout', { p_payout_id: claim.payout_id, p_initiated: false, p_transfer_id: null, p_error: reason });
    return { action: 'failed', payoutId: claim.payout_id, reason };
  }
}
