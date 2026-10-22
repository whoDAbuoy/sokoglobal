'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeft, BellOff, Clock, Inbox, Loader2, Mail, MessageCircle, MessageSquareReply, Package, Search, Send, Tag, Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';
import { createClient } from '@/lib/supabase/client';
import { formatChatTime, pickChannelName, type ChatMessage, type ChatThreadSummary } from '@/lib/chat';
import { CHAT_BOXES, CHAT_BOX_LABEL, chatBoxCounts, filterThreads, productLabels, threadDot, type ChatBox } from '@/lib/chat-hub';
import { initials, snippet } from '@/lib/admin-inbox';
import { useMutedIds } from '@/hooks/useMutedIds';
import ChatThread from '@/components/chat/ChatThread';

const MUTE_KEY = 'sg-chat-muted-threads';
const BOX_ICON: Record<ChatBox, LucideIcon> = { inbox: Inbox, unread: Mail, awaiting: MessageSquareReply, sent: Send, muted: BellOff };

const ROLE_COPY = {
  importer: {
    title: 'Supplier messages', labels: 'Products', empty: 'Message a supplier from any Trial Batch to ask about quotes, lead times or shipping.',
    tag: 'Supplier', shortcut: { href: '/dashboard/orders', label: 'Track my orders', icon: Package },
  },
  supplier: {
    title: 'Buyer inquiries', labels: 'Your products', empty: 'Questions from importers about your products, purchase orders and escrow will appear here.',
    tag: 'Buyer inquiry', shortcut: { href: '/supplier#pipeline', label: 'Fulfilment pipeline', icon: Workflow },
  },
} as const;

/**
 * Three-column messaging hub for importers and suppliers (same layout as the
 * admin Support inbox): mailboxes + product labels, the conversation list and
 * the thread with a reply drawer. Live via Supabase Realtime on chat_messages
 * (RLS limits events to the user's own threads). Mute is a per-browser setting.
 */
export default function MessagingHub({ basePath, role, initialThreadId = null }: {
  basePath: '/dashboard/messages' | '/supplier/messages';
  role: 'importer' | 'supplier';
  initialThreadId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const { refreshUnread } = useChat();
  const myId = user?.id ?? null;
  const { muted, isMuted, setMutedFor } = useMutedIds(MUTE_KEY);
  const copy = ROLE_COPY[role];

  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [box, setBox] = useState<ChatBox>('inbox');
  const [label, setLabel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const seq = useRef(0);
  const live = useRef({ threads, selectedId, muted });
  live.current = { threads, selectedId, muted };

  const loadThreads = useCallback(async () => {
    const n = ++seq.current;
    const { data, error: rpcError } = await supabase.rpc('my_chat_threads');
    if (n !== seq.current) return;
    if (rpcError) setError(rpcError.message || 'Could not load conversations');
    else { setError(null); setThreads((data ?? []) as ChatThreadSummary[]); }
    setLoading(false);
  }, [supabase]);

  // Initial load, then refresh the list (and toast) on every message we can see.
  useEffect(() => {
    if (!myId) return;
    void loadThreads();
    const name = pickChannelName('messages:hub', supabase.getChannels().map((c) => c.topic));
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const m = payload.new as ChatMessage;
        const { threads: ts, selectedId: open, muted: mutedNow } = live.current;
        if (m.sender_id !== myId && m.thread_id !== open && !mutedNow.includes(m.thread_id)) {
          const t = ts.find((x) => x.thread_id === m.thread_id);
          toast(`${t?.counterpart_name ?? 'New message'}${t ? ` · ${t.product_title}` : ''}`, {
            description: snippet(m.content, 80),
            action: { label: 'Open', onClick: () => select(m.thread_id) },
          });
        }
        void loadThreads();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, myId, loadThreads]);

  const onRead = useCallback(async () => { await Promise.all([loadThreads(), refreshUnread()]); }, [loadThreads, refreshUnread]);

  function select(id: string | null) {
    setSelectedId(id);
    router.replace(id ? `${basePath}?thread=${id}` : basePath, { scroll: false });
  }

  const counts = useMemo(() => chatBoxCounts(threads, myId, muted), [threads, myId, muted]);
  const labels = useMemo(() => productLabels(threads), [threads]);
  const visible = useMemo(() => filterThreads(threads, { box, label, query, myId, muted }), [threads, box, label, query, myId, muted]);
  const selected = threads.find((t) => t.thread_id === selectedId) ?? null;

  const navItem = (active: boolean) => clsx('press flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm',
    active ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900');

  if (loading) {
    return <div className="card mt-6 grid h-64 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading conversations" /></div>;
  }
  if (error && threads.length === 0) {
    return <p className="card mt-6 flex items-start gap-2 p-6 text-sm text-rose-700 dark:text-rose-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>;
  }

  const Shortcut = copy.shortcut.icon;
  return (
    <div className="card mt-6 grid overflow-hidden p-0 lg:h-[calc(100dvh-14rem)] lg:min-h-[32rem] lg:grid-cols-[13rem_20rem_minmax(0,1fr)]">
      {/* Column 1: mailboxes + product labels (chips below lg) */}
      <aside className="border-b border-neutral-200 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <p className="hidden px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-neutral-500 lg:block">Mailboxes</p>
        <div role="group" aria-label="Mailboxes" className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {CHAT_BOXES.map((b) => {
            const Icon = BOX_ICON[b];
            return (
              <button key={b} type="button" aria-pressed={box === b && !label} onClick={() => { setBox(b); setLabel(null); }} className={navItem(box === b && !label)}>
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">{CHAT_BOX_LABEL[role][b]}</span>
                {counts[b] > 0 && <span className={clsx('text-xs tabular-nums', b === 'unread' ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-neutral-500')}>{counts[b]}</span>}
              </button>
            );
          })}
        </div>
        {labels.length > 0 && (
          <>
            <div className="my-3 hidden border-t border-neutral-200 lg:block" />
            <p className="hidden px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-neutral-500 lg:block">{copy.labels}</p>
            <div role="group" aria-label={copy.labels} className="no-scrollbar mt-2 flex gap-1 overflow-x-auto lg:mt-0 lg:flex-col lg:overflow-visible">
              {labels.map((l) => (
                <button key={l.key} type="button" aria-pressed={label === l.key} onClick={() => { setLabel(label === l.key ? null : l.key); setBox('inbox'); }} className={navItem(label === l.key)}>
                  <Tag className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
                  <span className="flex-1 truncate">{l.title}</span>
                  <span className="text-xs tabular-nums text-neutral-500">{l.unread || l.count}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <Link href={copy.shortcut.href} className="press mt-4 hidden items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-400 lg:flex">
          <Shortcut className="h-3.5 w-3.5" aria-hidden /> {copy.shortcut.label}
        </Link>
      </aside>

      {/* Column 2: conversation list */}
      <section aria-label="Conversations" className={clsx('flex min-h-0 flex-col border-neutral-200 lg:border-r', selectedId ? 'hidden lg:flex' : 'flex')}>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <h2 className="font-semibold text-neutral-900">{label ? labels.find((l) => l.key === label)?.title ?? copy.title : CHAT_BOX_LABEL[role][box]}</h2>
          <span className="text-xs tabular-nums text-neutral-500">{visible.length}</span>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product, company, message" aria-label="Search conversations" className="input py-2 pl-9" />
          </div>
        </div>
        <ul className="min-h-0 max-h-[60vh] flex-1 space-y-1 overflow-y-auto px-2 pb-3 lg:max-h-none" aria-live="polite">
          {visible.length === 0 && (
            <li className="flex flex-col items-center px-3 py-10 text-center text-sm text-neutral-500">
              <MessageCircle className="h-7 w-7 text-neutral-300" strokeWidth={1.5} aria-hidden />
              <span className="mt-2">{threads.length === 0 ? copy.empty : 'Nothing in this mailbox.'}</span>
            </li>
          )}
          {visible.map((t) => {
            const dot = threadDot(t, myId);
            const active = t.thread_id === selectedId;
            const unread = t.unread_count > 0;
            return (
              <li key={t.thread_id}>
                <button type="button" onClick={() => select(t.thread_id)} aria-current={active ? 'true' : undefined}
                  className={clsx('press flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left', active ? 'border-neutral-300 bg-neutral-100' : 'border-transparent hover:bg-neutral-50')}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500/15 to-cyan-500/15 text-xs font-semibold text-neutral-800 ring-1 ring-neutral-200">{initials(t.counterpart_name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={clsx('truncate text-sm', unread ? 'font-semibold text-neutral-900' : 'font-medium text-neutral-900')}>{t.counterpart_name}</span>
                        {(t.kind === 'direct' || t.last_from_admin) && (
                          <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-semibold uppercase tone-active" title="System / Admin message">Admin</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-neutral-500">{formatChatTime(t.last_message_at ?? t.updated_at)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-neutral-800">{t.product_title}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={clsx('flex-1 truncate text-xs', unread ? 'font-medium text-neutral-900' : 'text-neutral-500')}>
                        {t.last_message ? `${t.last_sender_id === myId ? 'You: ' : ''}${snippet(t.last_message, 70)}` : 'No messages yet'}
                      </span>
                      {isMuted(t.thread_id) && <BellOff className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-label="Muted" />}
                      {unread
                        ? <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold tabular-nums text-snow" aria-label={`${t.unread_count} unread`}>{t.unread_count > 99 ? '99+' : t.unread_count}</span>
                        : <span className={clsx('h-2 w-2 shrink-0 rounded-full', dot.className)} title={dot.label} aria-label={dot.label} />}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Column 3: thread + reply drawer */}
      <section aria-label="Conversation" className={clsx('min-h-[28rem] min-w-0 flex-col', selectedId ? 'flex' : 'hidden lg:flex')}>
        {selectedId ? (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
              <button type="button" onClick={() => select(null)} aria-label="Back to conversations" className="press mr-1 rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 lg:hidden">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <span className="pill tone-active">{copy.tag}</span>
              {selected && selected.unread_count > 0 && <span className="pill tone-pending"><Clock className="h-3 w-3" aria-hidden /> {selected.unread_count} new</span>}
              {selected?.product_id && role === 'supplier' && (
                <Link href={`/supplier/products/${selected.product_id}`} className="btn-secondary ml-auto px-2.5 py-1.5 text-xs"><Package className="h-3.5 w-3.5" aria-hidden /> View product</Link>
              )}
              {role === 'importer' && (
                <Link href="/dashboard/orders" className="btn-secondary ml-auto px-2.5 py-1.5 text-xs"><Package className="h-3.5 w-3.5" aria-hidden /> My orders</Link>
              )}
            </header>
            <div className="flex items-start gap-3 border-b border-neutral-200 px-5 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-neutral-300 text-sm font-semibold text-neutral-700">{initials(selected?.counterpart_name)}</span>
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-neutral-900">{selected?.product_title ?? 'Conversation'}</h3>
                {selected && <p className="truncate text-sm text-neutral-600">with {selected.counterpart_name}</p>}
              </div>
            </div>
            <ChatThread key={selectedId} threadId={selectedId} onRead={onRead} className="flex-1" collapseAfter={8}
              composerExtra={(
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                  <button type="button" role="switch" aria-checked={isMuted(selectedId)} onClick={() => setMutedFor(selectedId, !isMuted(selectedId))}
                    className={clsx('relative h-5 w-9 rounded-full transition-colors', isMuted(selectedId) ? 'bg-blue-600' : 'bg-neutral-300')}>
                    <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-snow shadow transition-transform', isMuted(selectedId) ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
                  </button>
                  Mute this thread
                </label>
              )} />
          </>
        ) : (
          <div className="m-auto flex flex-col items-center px-6 py-16 text-center">
            <MessageCircle className="h-8 w-8 text-neutral-300" strokeWidth={1.5} aria-hidden />
            <p className="mt-3 font-medium text-neutral-900">{threads.length === 0 ? 'No conversations yet' : 'Select a conversation'}</p>
            <p className="mt-1 max-w-xs text-sm text-neutral-500">{threads.length === 0 ? copy.empty : 'New messages stream in live.'}</p>
          </div>
        )}
      </section>
    </div>
  );
}

