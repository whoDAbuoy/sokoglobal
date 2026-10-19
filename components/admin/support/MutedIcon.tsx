'use client';

import { BellOff } from 'lucide-react';
import { useMutedTickets } from './useMutedTickets';

export default function MutedIcon({ ticketId }: { ticketId: string }) {
  const { isMuted } = useMutedTickets();
  if (!isMuted(ticketId)) return null;
  return <BellOff className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-label="Muted" />;
}
