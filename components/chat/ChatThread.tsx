'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { AlertCircle, Loader2, MessageCircle, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { MAX_MESSAGE_LENGTH, formatChatTime, mergeMessages, pickChannelName, validateMessage, type ChatMessage } from '@/lib/chat';

const COLUMNS = 'id, thread_id, sender_id, content, created_at, read_at';
const HISTORY_LIMIT = 200;
const COUNTER_FROM = MAX_MESSAGE_LENGTH - 500;

const errorMessage = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message ? err.message : fallback;

/**
 * One conversation: history (latest 200), live updates via Realtime and a
 * composer. `onRead` runs after the other party's messages are marked read
 * (pass the chat context's refreshUnread, plus anything else to refresh).
 */
export default function ChatThread({ threadId, className, onRead }: {
  threadId: string;
  className?: string;
  onRead?: () => void | Promise<void>;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const markRead = useCallback(async () => {
    const { error } = await supabase.rpc('mark_chat_read', { p_thread_id: threadId });
    if (!error) await onReadRef.current?.();
  }, [supabase, threadId]);

  // Load history, mark as read, then stream inserts (and read-receipt updates) for this thread.
  useEffect(() => {
    if (!myId) return;
    let active = true;
    setMessages([]);
    setLoading(true);
    setLoadError(null);
    setSendError(null);

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
      const { data, error } = await supabase
        .from('chat_messages')
        .select(COLUMNS)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (!active) return;
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

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (sending || !myId) return;
    const v = validateMessage(text);
    if (!v.ok) { setSendError(v.error); return; }
    setSending(true);
    setSendError(null);
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ thread_id: threadId, sender_id: myId, content: v.content })
      .select(COLUMNS)
      .single();
    setSending(false);
    if (error) { setSendError(errorMessage(error, 'Could not send your message')); return; }
    setMessages((prev) => mergeMessages(prev, [data as ChatMessage]));
    setText('');
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  let lastReadMine = -1;
  messages.forEach((m, i) => { if (m.sender_id === myId && m.read_at) lastReadMine = i; });
  const length = text.trim().length;

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
            <p className="mt-1 max-w-xs text-sm text-neutral-500">Ask about minimum order quantities, lead times, materials or anything else.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m, i) => {
              const mine = m.sender_id === myId;
              return (
                <li key={m.id} className={clsx('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <div className={clsx('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
                    mine ? 'rounded-br-md bg-neutral-900 text-white' : 'rounded-bl-md bg-neutral-100 text-neutral-900')}>
                    {m.content}
                  </div>
                  <span className="mt-1 px-1 text-[11px] text-neutral-400">
                    <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('en-GB')}>{formatChatTime(m.created_at)}</time>
                    {i === lastReadMine && <> · Read</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={(e) => void send(e)} className="border-t border-neutral-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-end gap-2">
          <label htmlFor={`chat-input-${threadId}`} className="sr-only">Message</label>
          <textarea
            id={`chat-input-${threadId}`}
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (sendError) setSendError(null); }}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Write a message…"
            disabled={!myId}
            className="input max-h-40 min-h-[2.75rem] flex-1 resize-none"
          />
          <button type="submit" disabled={sending || !myId || length === 0} aria-label="Send message" className="btn-primary h-11 shrink-0 px-4">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <div className="mt-1.5 flex min-h-[1rem] items-start justify-between gap-3 text-xs">
          {sendError
            ? <p role="alert" className="flex items-start gap-1.5 text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{sendError}</p>
            : <p className="text-neutral-400">Enter to send · Shift+Enter for a new line</p>}
          {length >= COUNTER_FROM && (
            <span className={clsx('shrink-0 tabular-nums', length > MAX_MESSAGE_LENGTH ? 'text-red-600' : 'text-neutral-500')}>
              {length.toLocaleString('en-GB')}/{MAX_MESSAGE_LENGTH.toLocaleString('en-GB')}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
