'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { snippet } from '@/lib/admin-inbox';
import { useMutedTickets } from './useMutedTickets';

/**
 * Live updates for the agent inbox: any new support message (admins can read
 * them all under RLS) re-renders the server page. Customer messages on threads
 * that aren't muted also raise a toast.
 */
export default function InboxRealtime({ subjects }: { subjects: Record<string, string> }) {
  const router = useRouter();
  const { muted } = useMutedTickets();
  const mutedRef = useRef(muted);
  const subjectsRef = useRef(subjects);
  mutedRef.current = muted;
  subjectsRef.current = subjects;

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`admin-support-inbox-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, (payload) => {
        const row = payload.new as { ticket_id?: string; body?: string; sender_role?: string };
        if (row.sender_role === 'customer' && row.ticket_id && !mutedRef.current.includes(row.ticket_id)) {
          const subject = subjectsRef.current[row.ticket_id] ?? 'Support';
          toast(`New message · ${subject}`, { description: snippet(row.body, 80) });
        }
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [router]);

  return null;
}
