import type { EscrowStatus } from '@/lib/types';

export type OrderStage = 'awaiting' | 'escrow' | 'completed' | 'closed';

export const ESCROW_HELD: readonly EscrowStatus[] = [
  'funded',
  'in_transit',
  'customs_cleared',
  'delivered_pending_verification',
  'disputed',
];

export function stageOf(status: EscrowStatus): OrderStage {
  if (status === 'pending_payment') return 'awaiting';
  if (status === 'released') return 'completed';
  if (ESCROW_HELD.includes(status)) return 'escrow';
  return 'closed'; // refunded / cancelled
}

export interface OrderCounts {
  total: number;
  awaiting: number;
  escrow: number;
  completed: number;
  closed: number;
  escrowCents: number;
}

export function emptyCounts(): OrderCounts {
  return { total: 0, awaiting: 0, escrow: 0, completed: 0, closed: 0, escrowCents: 0 };
}

export function addOrder(c: OrderCounts, status: EscrowStatus, totalCents: number) {
  const stage = stageOf(status);
  c.total += 1;
  c[stage] += 1;
  if (stage === 'escrow') c.escrowCents += totalCents ?? 0;
}

export const STAGE_META: Record<OrderStage, { label: string; bar: string; dot: string }> = {
  awaiting: { label: 'awaiting payment', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  escrow: { label: 'in escrow', bar: 'bg-neutral-900', dot: 'bg-neutral-900' },
  completed: { label: 'completed', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  closed: { label: 'refunded / cancelled', bar: 'bg-neutral-300', dot: 'bg-neutral-300' },
};
