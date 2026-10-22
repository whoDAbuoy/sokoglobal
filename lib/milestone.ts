/**
 * Milestone escrow (pure). Mirrors migration 021: milestone_deposit_cents(),
 * milestone_min_cents(), milestone_eligible(), order_amount_due_cents(),
 * order_paid_cents() and milestone_settled_status(). All amounts are USD cents.
 */
import type { EscrowStatus } from './types';

export type PaymentStructure = 'full' | 'milestone_30_70' | 'credit_30_days';

export const MILESTONE_DEPOSIT_PCT = 30;
/** Smallest order that may use milestone escrow ($1,000). */
export const MILESTONE_MIN_CENTS = 100_000;

export const PAYMENT_STRUCTURE_LABEL: Record<PaymentStructure, string> = {
  full: 'Pay in full',
  milestone_30_70: 'Milestone escrow (30% upfront / 70% on dispatch)',
  credit_30_days: 'Trade credit (30 days)',
};

/** 30% deposit rounded up to the cent; the balance is the rest. Integer maths, same as Postgres. */
export function milestoneSplit(totalCents: number): { depositCents: number; balanceCents: number } {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error('Total must be a positive integer of cents');
  const depositCents = Math.floor((totalCents * MILESTONE_DEPOSIT_PCT + 99) / 100);
  return { depositCents, balanceCents: totalCents - depositCents };
}

export function milestoneEligible(o: { totalCents: number; kycApproved: boolean; inCart: boolean; orderType: string }): boolean {
  return !o.inCart && o.orderType !== 'pool' && o.kycApproved && o.totalCents >= MILESTONE_MIN_CENTS;
}

export interface PayableOrder {
  escrow_status: EscrowStatus;
  payment_structure?: PaymentStructure | string | null;
  total_cents: number;
  deposit_amount?: number | null;
  remaining_balance?: number | null;
  final_paid_at?: string | null;
  deposit_paid_at?: string | null;
  funded_at?: string | null;
  current_status?: string | null;
}

const isMilestone = (o: PayableOrder) => o.payment_structure === 'milestone_30_70';

/** USD cents the buyer owes right now (0 = nothing payable). */
export function amountDue(o: PayableOrder): number {
  if (o.escrow_status === 'pending_payment') return isMilestone(o) ? o.deposit_amount ?? milestoneSplit(o.total_cents).depositCents : o.total_cents;
  if (o.escrow_status === 'deposit_paid' && !o.final_paid_at) return o.remaining_balance ?? 0;
  return 0;
}

/** USD cents actually collected (refund cap). */
export function paidCents(o: PayableOrder): number {
  if (!o.funded_at && !o.deposit_paid_at) return 0;
  if (isMilestone(o) && !o.final_paid_at) return o.deposit_amount ?? 0;
  return o.total_cents;
}

export type PaymentStep =
  | { kind: 'pay_full'; amountCents: number }
  | { kind: 'pay_deposit'; amountCents: number; balanceCents: number }
  | { kind: 'balance_waiting'; balanceCents: number }
  | { kind: 'pay_balance'; amountCents: number }
  | { kind: 'none' };

/** What the buyer's order page offers: pay in full, pay the deposit, wait for dispatch, or pay the balance. */
export function paymentStep(o: PayableOrder): PaymentStep {
  if (o.escrow_status === 'pending_payment') {
    if (!isMilestone(o)) return { kind: 'pay_full', amountCents: o.total_cents };
    const split = o.deposit_amount != null && o.remaining_balance != null
      ? { depositCents: o.deposit_amount, balanceCents: o.remaining_balance }
      : milestoneSplit(o.total_cents);
    return { kind: 'pay_deposit', amountCents: split.depositCents, balanceCents: split.balanceCents };
  }
  if (o.escrow_status === 'deposit_paid' && !o.final_paid_at) {
    const balance = o.remaining_balance ?? 0;
    return (o.current_status ?? 'awaiting_dispatch') === 'awaiting_dispatch'
      ? { kind: 'balance_waiting', balanceCents: balance }
      : { kind: 'pay_balance', amountCents: balance };
  }
  return { kind: 'none' };
}

/** Escrow state an order moves to when its balance lands, from where the shipment is. */
export function settledStatus(currentStatus: string | null | undefined): EscrowStatus {
  switch (currentStatus) {
    case 'in_transit':
    case 'arrived': return 'in_transit';
    case 'customs_cleared':
    case 'out_for_delivery': return 'customs_cleared';
    case 'delivered': return 'delivered_pending_verification';
    default: return 'funded';
  }
}
