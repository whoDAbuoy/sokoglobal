'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AlertCircle, ArrowLeft, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';
import { createClient } from '@/lib/supabase/client';
import { formatChatTime, pickChannelName, type ChatThreadSummary } from '@/lib/chat';
import ChatThread from '@/components/chat/ChatThread';

const EMPTY_TEXT = {
  '/dashboard/messages': 'Message a supplier from any product to start a conversation.',
  '/supplier/messages': 'Buyer questions about your products will appear here.',
} as const;

/** Two-pane inbox: thread list + the selected conversation (list OR thread on small screens). */
export default function ChatInbox({ basePath, initialThreadId = null }: {
  basePath: '/dashboard/messages' | '/supplier/messages';
  initialThreadId?: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const { refreshUnread } = useChat();
  const myId = user?.id ?? null;

  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const seq = useRef(0);

  const loadThreads = useCallback(async () => {
    const n = ++seq.current;
    const { data, error: rpcError } = await supabase.rpc('my_chat_threads');
    if (n !== seq.current) return; // a newer refresh is in flight
    if (rpcError) setError(rpcError.message || 'Could not load conversations');
    else { setError(null); setThreads((data ?? []) as ChatThreadSummary[]); }
    setLoading(false);
  }, [supabase]);

  // Initial load + refresh the list on any message we can see.
  useEffect(() => {
    if (!myId) return;
    void loadThreads();
    const name = pickChannelName('messages:inbox', supabase.getChannels().map((c) => c.topic));
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => { void loadThreads(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, myId, loadThreads]);

  const onRead = useCallback(async () => {
    await Promise.all([loadThreads(), refreshUnread()]);
  }, [loadThreads, refreshUnread]);

  function select(id: string | null) {
    setSelectedId(id);
    router.replace(id ? `${basePath}?thread=${id}` : basePath, { scroll: false });
  }

  const selected = threads.find((t) => t.thread_id === selectedId) ?? null;

  if (loading) {
    return <div className="card mt-8 grid h-64 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading conversations" /></div>;
  }

  if (error && threads.length === 0) {
    return <p className="card mt-8 flex items-start gap-2 p-6 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>;
  }

  if (threads.length === 0 && !selectedId) {
    return (
      <div className="card mt-8 flex flex-col items-center justify-center px-6 py-16 text-center">
        <MessageCircle className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
        <p className="mt-3 font-medium text-neutral-900">No conversations yet</p>
        <p className="mt-1 max-w-sm text-sm text-neutral-500">{EMPTY_TEXT[basePath]}</p>
      </div>
    );
  }

  return (
    <div className="card mt-8 grid h-[calc(100dvh-16rem)] min-h-[28rem] overflow-hidden p-0 md:grid-cols-[20rem_1fr]">
      {/* Thread list */}
      <nav aria-label="Conversations" className={clsx('min-h-0 overflow-y-auto border-neutral-200 md:border-r', selectedId ? 'hidden md:block' : 'block')}>
        <ul className="divide-y divide-neutral-200">
          {threads.map((t) => {
            const unread = t.unread_count > 0;
            const active = t.thread_id === selectedId;
            const fromMe = t.last_sender_id === myId;
            return (
              <li key={t.thread_id}>
                <button type="button" onClick={() => select(t.thread_id)} aria-current={active ? 'true' : undefined}
                  className={clsx('flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors', active ? 'bg-neutral-100' : 'hover:bg-neutral-50')}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={clsx('truncate text-sm', unread ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-800')}>{t.product_title}</span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{formatChatTime(t.last_message_at ?? t.updated_at)}</span>
                  </span>
                  <span className="truncate text-xs text-neutral-500">{t.counterpart_name}</span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={clsx('truncate text-xs', unread ? 'font-semibold text-neutral-900' : 'text-neutral-500')}>
                      {t.last_message ? `${fromMe ? 'You: ' : ''}${t.last_message}` : 'No messages yet'}
                    </span>
                    {unread && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-neutral-900 px-1.5 text-[11px] font-semibold tabular-nums text-white"
                        aria-label={`${t.unread_count} unread`}>
                        {t.unread_count > 99 ? '99+' : t.unread_count}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Conversation */}
      <section className={clsx('min-h-0 flex-col', selectedId ? 'flex' : 'hidden md:flex')} aria-label="Conversation">
        {selectedId ? (
          <>
            <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 sm:px-6">
              <button type="button" onClick={() => select(null)} aria-label="Back to conversations"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 md:hidden">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate font-semibold text-neutral-900">{selected?.product_title ?? 'Conversation'}</p>
                {selected && <p className="truncate text-xs text-neutral-500">with {selected.counterpart_name}</p>}
              </div>
            </header>
            <ChatThread key={selectedId} threadId={selectedId} onRead={onRead} className="flex-1" />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <MessageCircle className="h-8 w-8 text-neutral-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-neutral-500">Select a conversation</p>
          </div>
        )}
      </section>
    </div>
  );
}
