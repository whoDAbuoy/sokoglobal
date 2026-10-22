'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MessagesSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * "Message user" (super admins): gets or creates the user's direct support thread
 * (start_direct_thread, migration 025) and opens it in the admin chat center.
 */
export default function MessageUserButton({ userId, name, className = 'btn-secondary px-2.5 py-1.5 text-xs' }: { userId: string; name: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    const { data, error } = await createClient().rpc('start_direct_thread', { p_user_id: userId });
    const thread = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
    if (error || !thread?.id) { setBusy(false); toast.error(error?.message ?? 'Could not open the conversation'); return; }
    router.push(`/admin/messages?thread=${thread.id}`);
  }

  return (
    <button type="button" onClick={() => void open()} disabled={busy} className={className} aria-label={`Message ${name}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MessagesSquare className="h-3.5 w-3.5" aria-hidden />} Message user
    </button>
  );
}
