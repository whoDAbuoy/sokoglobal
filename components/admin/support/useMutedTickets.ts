'use client';

import { useMutedIds } from '@/hooks/useMutedIds';

/**
 * Muted support threads — a per-browser preference for this agent (no new
 * database column). A muted thread still gets replies; it just stops raising
 * the "new message" toast and is marked in the list.
 */
export function useMutedTickets() {
  return useMutedIds('sg-admin-muted-tickets');
}
