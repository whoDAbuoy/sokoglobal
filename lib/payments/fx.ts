/**
 * FX payout planning (pure logic — the quote function is injected so it can be
 * unit-tested without Flutterwave).
 *
 * Problem: escrow holds USD; a Kenyan supplier is paid in KES. Flutterwave's
 * rate endpoint answers "how much SOURCE does it cost to deliver N units of
 * DESTINATION?" and transfers take `amount` in the destination currency. So:
 *
 *   1. Probe: cost of 100,000 KES → USD-per-KES.
 *   2. Estimate: KES = floor(netUSD / USD-per-KES).
 *   3. Confirm: re-quote that exact KES amount. If it would debit more than the
 *      supplier's net USD (rate moved / rounding), shrink and re-quote.
 *
 * Guarantee: the returned plan never debits more USD than `netCents`. The DB
 * enforces the same bound again in record_payout_fx(). The FX spread is borne
 * by the supplier (they receive the USD net at Flutterwave's transfer rate).
 */
export type QuoteFn = (destinationAmount: number) => Promise<{ sourceAmount: number; destinationAmount: number }>;

export interface FxPlan {
  destinationAmount: number;   // whole units of payout currency (Flutterwave's rate API is integer-based)
  sourceCents: number;         // USD cents the quote debits (≤ netCents)
  rate: number;                // payout currency units per 1 USD
}

export class FxPlanError extends Error {
  constructor(message: string) { super(message); this.name = 'FxPlanError'; }
}

// Large probe → the rate is precise to ~0.001% even though quotes round to cents.
const PROBE_UNITS = 100_000;
const MAX_CONFIRMS = 3;

export async function planFxPayout(netCents: number, quote: QuoteFn): Promise<FxPlan> {
  if (!Number.isInteger(netCents) || netCents <= 0) throw new FxPlanError('Net payout must be a positive integer of cents');

  const probe = await quote(PROBE_UNITS);
  const usdPerUnit = probe.sourceAmount / probe.destinationAmount;
  if (!(usdPerUnit > 0) || !Number.isFinite(usdPerUnit)) throw new FxPlanError('Invalid FX probe quote');

  let units = Math.floor(netCents / 100 / usdPerUnit);
  for (let i = 0; i < MAX_CONFIRMS; i += 1) {
    if (units < 1) throw new FxPlanError('Net payout is too small to convert');
    const q = await quote(units);
    // Round the USD cost UP to the cent so we never under-estimate the debit.
    const sourceCents = Math.ceil(q.sourceAmount * 100 - 1e-6);
    if (sourceCents <= netCents) {
      return { destinationAmount: units, sourceCents, rate: units / (sourceCents / 100) };
    }
    // Rate moved against us — shrink proportionally with a 0.2% margin and re-quote.
    units = Math.floor(((units * netCents) / sourceCents) * 0.998);
  }
  throw new FxPlanError('Could not get an FX quote within the net payout');
}
