'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, ChevronDown, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { CHAT_MESSAGE_COLUMNS, mergeMessages, pickChannelName, type ChatMessage } from '@/lib/chat';
import ChatInput from './ChatInput';
import ChatMessageItem from './ChatMessageItem';

const HISTORY_LIMIT = 200;

const errorMessage = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message ? err.message : fallback;

/**
 * One conversation: history (latest 200), live updates via Realtime (postgres
 * INSERT / UPDATE on chat_messages filtered by thread, RLS applied per
 * subscriber) and a composer. Order chats (chat_threads.order_id, migration 024)
 * also take attachments and voice notes. `onRead` runs after the other party's
 * messages are marked read (pass the chat context's refreshUnread, plus anything else to refresh).
 */
export default function ChatThread({ threadId, className, onRead, collapseAfter, composerExtra }: {
  threadId: string;
  className?: string;
  onRead?: () => void | Promise<void>;
  /** Show only the latest N messages behind an "N earlier messages" toggle (hub view). Off by default. */
  collapseAfter?: number;
  /** Extra controls in the composer footer (e.g. the hub's "Mute this thread" switch). */
  composerExtra?: ReactNode;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => { setShowEarlier(false); }, [threadId]);

  const markRead = useCallback(async () => {
    const { error } = await supabase.rpc('mark_chat_read', { p_thread_id: threadId });
    if (!error) await onReadRef.current?.();
  }, [supabase, threadId]);

  // Load history, mark as read, then stream inserts (and read-receipt updates) for this thread.
  useEffect(() => {
    if (!myId) return;
    let active = true;
    setMessages([]);
    setOrderId(null);
    setLoading(true);
    setLoadError(null);

    const name = pickChannelName(`messages:${threadId}`, supabase.getChannels().map((c) => c.topic));
    const filter = `thread_id=eq.${threadId}`;
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!active || m.thread_id !== threadId) return;
        setMessages((prev) => mergeMessages(prev, [m]));
        if (m.sender_id !== myId) void markRead();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!active || m.thread_id !== threadId) return;
        setMessages((prev) => (prev.some((p) => p.id === m.id) ? mergeMessages(prev, [m]) : prev));
      })
      .subscribe();

    (async () => {
      const [{ data, error }, { data: thread }] = await Promise.all([
        supabase.from('chat_messages').select(CHAT_MESSAGE_COLUMNS).eq('thread_id', threadId)
          .order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
        supabase.from('chat_threads').select('order_id').eq('id', threadId).maybeSingle(),
      ]);
      if (!active) return;
      setOrderId((thread?.order_id as string | null) ?? null);
      if (error) setLoadError(errorMessage(error, 'Could not load messages'));
      // Merge (not replace) so realtime messages that arrived during the fetch are kept.
      else setMessages((prev) => mergeMessages(prev, (data ?? []) as ChatMessage[]));
      setLoading(false);
      void markRead();
    })();

    return () => { active = false; void supabase.removeChannel(channel); };
  }, [supabase, threadId, myId, markRead]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  let lastReadMine = -1;
  messages.forEach((m, i) => { if (m.sender_id === myId && m.read_at) lastReadMine = i; });
  const hiddenCount = collapseAfter && !showEarlier ? Math.max(0, messages.length - collapseAfter) : 0;
  const onSent = useCallback((m: ChatMessage) => setMessages((prev) => mergeMessages(prev, [m])), []);

  return (
    <div className={clsx('flex min-h-0 flex-col', className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" aria-live="polite">
        {loading ? (
          <div className="grid h-full place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading messages" /></div>
        ) : loadError ? (
          <p className="flex items-start gap-1.5 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{loadError}</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircle className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
            <p className="mt-3 font-medium text-neutral-900">No messages yet</p>
            <p className="mt-1 max-w-xs text-sm text-neutral-500">
              {orderId ? 'Coordinate this order: share photos, documents or a quick voice note.' : 'Ask about minimum order quantities, lead times, materials or anything else.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {(hiddenCount > 0 || (collapseAfter && showEarlier && messages.length > collapseAfter)) && (
              <li className="flex justify-center">
                <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier}
                  className="press inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:text-neutral-900">
                  <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', showEarlier ? 'rotate-180' : '')} aria-hidden />
                  {showEarlier ? 'Hide earlier messages' : `${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'}`}
                </button>
              </li>
            )}
            {messages.map((m, i) => (i < hiddenCount ? null
              : <ChatMessageItem key={m.id} message={m} mine={m.sender_id === myId} showRead={i === lastReadMine} />))}
          </ul>
        )}
      </div>

      <ChatInput threadId={threadId} orderId={orderId} myId={myId} onSent={onSent} composerExtra={composerExtra} />
    </div>
  );
}
