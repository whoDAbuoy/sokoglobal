'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useChat } from '@/context/ChatContext';
import ChatThread from './ChatThread';

/**
 * Inline order chat on the order page. Shows the conversation if it exists;
 * otherwise a "Start chat" button, so viewing an order never creates a thread.
 * Render only for paid orders (start_order_chat() refuses unpaid ones).
 */
export default function OrderChatPanel({ orderId, counterpart }: { orderId: string; counterpart: string }) {
  const supabase = createClient();
  const { refreshUnread } = useChat();
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.from('chat_threads').select('id').eq('order_id', orderId).maybeSingle()
      .then(({ data }) => { if (active) setThreadId((data?.id as string | undefined) ?? null); });
    return () => { active = false; };
  }, [supabase, orderId]);

  async function start() {
    setStarting(true);
    const { data, error } = await supabase.rpc('start_order_chat', { p_order_id: orderId });
    setStarting(false);
    const thread = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
    if (error || !thread?.id) { toast.error(error?.message ?? 'Could not open the order chat'); return; }
    setThreadId(thread.id);
  }

  return (
    <section aria-labelledby={`order-chat-${orderId}`} className="card mt-6 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
        <MessagesSquare className="h-4 w-4 text-neutral-500" aria-hidden />
        <h2 id={`order-chat-${orderId}`} className="text-sm font-semibold text-neutral-900">Order chat with {counterpart}</h2>
      </header>
      {threadId === undefined ? (
        <div className="grid h-24 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading chat" /></div>
      ) : threadId === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-neutral-600">Coordinate this order in one place: messages, photos, videos, documents and voice notes.</p>
          <button type="button" onClick={() => void start()} disabled={starting} className="btn-primary px-3.5 py-2 text-sm">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessagesSquare className="h-4 w-4" aria-hidden />} Start chat
          </button>
        </div>
      ) : (
        <ChatThread threadId={threadId} onRead={refreshUnread} className="h-[28rem]" />
      )}
    </section>
  );
}
