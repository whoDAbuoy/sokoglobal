'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Loader2, MessageCircle, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useChat } from '@/context/ChatContext';
import { formatChatTime, pickChannelName } from '@/lib/chat';
import { CHAT_KINDS, CHAT_KIND_LABEL, adminThreadParties, type AdminChatThread } from '@/lib/chat-admin';
import type { ChatThreadKind } from '@/lib/chat';
import ChatThread from './ChatThread';

interface UserHit { id: string; full_name: string; company_name: string; email: string | null; role: string }

const ROLE_LABEL: Record<string, string> = { importer: 'Buyer', supplier: 'Supplier', admin: 'Admin', super_admin: 'Super admin' };

/**
 * Super-admin chat center: every conversation on the platform (admin_chat_threads,
 * migration 025) filtered by order / product / direct support and searchable,
 * plus a people search that opens (or creates) a direct support thread. Threads
 * open in the normal ChatThread, so admins get attachments, voice notes and the
 * emoji picker too; their messages are flagged "System / Admin message".
 */
export default function AdminChatCenter({ initialThreadId = null }: { initialThreadId?: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const { refreshUnread } = useChat();
  const [kind, setKind] = useState<ChatThreadKind | null>(null);
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<AdminChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialThreadId);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [people, setPeople] = useState<UserHit[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const reloadTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('admin_chat_threads', { p_kind: kind, p_query: query.trim() || null, p_limit: 150 });
    if (e) setError(e.message); else { setError(null); setThreads((data ?? []) as AdminChatThread[]); }
    setLoading(false);
  }, [supabase, kind, query]);

  // Filters and search (debounced).
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  // Any new message anywhere (admins can see all under RLS) refreshes the list, at most every 1.5 s.
  useEffect(() => {
    const name = pickChannelName('admin-chat-center', supabase.getChannels().map((c) => c.topic));
    const channel = supabase.channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
        window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(() => void load(), 1500);
      })
      .subscribe();
    return () => { window.clearTimeout(reloadTimer.current); void supabase.removeChannel(channel); };
  }, [supabase, load]);

  // People search (admin_list_users: name, company or email).
  useEffect(() => {
    const q = peopleQuery.trim();
    if (q.length < 2) { setPeople([]); return; }
    let active = true;
    setPeopleBusy(true);
    const t = window.setTimeout(async () => {
      const { data } = await supabase.rpc('admin_list_users', { p_query: q, p_role: null, p_status: null, p_limit: 8, p_offset: 0 });
      if (!active) return;
      setPeople(((data ?? []) as UserHit[]).filter((u) => u.role !== 'super_admin'));
      setPeopleBusy(false);
    }, 250);
    return () => { active = false; window.clearTimeout(t); };
  }, [supabase, peopleQuery]);

  function select(id: string | null) {
    setSelectedId(id);
    router.replace(id ? `/admin/messages?thread=${id}` : '/admin/messages', { scroll: false });
  }

  async function messageUser(u: UserHit) {
    setOpening(u.id);
    const { data, error: e } = await supabase.rpc('start_direct_thread', { p_user_id: u.id });
    setOpening(null);
    const thread = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
    if (e || !thread?.id) { toast.error(e?.message ?? 'Could not open the conversation'); return; }
    setPeopleQuery('');
    select(thread.id);
    void load();
  }

  const selected = useMemo(() => threads.find((t) => t.thread_id === selectedId) ?? null, [threads, selectedId]);
  const counts = useMemo(() => Object.fromEntries(CHAT_KINDS.map((k) => [k, threads.filter((t) => t.kind === k).length])), [threads]);

  return (
    <div className="card grid min-h-[36rem] overflow-hidden lg:h-[calc(100vh-11rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section aria-label="Conversations" className={clsx('flex min-h-0 flex-col border-neutral-200 lg:border-r', selectedId ? 'hidden lg:flex' : 'flex')}>
        <div className="space-y-3 border-b border-neutral-200 p-3">
          <div className="relative">
            <UserPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Message a user: name, company or email"
              aria-label="Find a user to message" className="input py-2 pl-9" />
            {(people.length > 0 || peopleBusy) && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-overlay">
                {peopleBusy && !people.length && <li className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…</li>}
                {people.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => void messageUser(u)} disabled={opening === u.id}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-neutral-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-900">{u.company_name} <span className="font-normal text-neutral-500">· {u.full_name}</span></span>
                        <span className="block truncate text-xs text-neutral-500">{ROLE_LABEL[u.role] ?? u.role}{u.email ? ` · ${u.email}` : ''}</span>
                      </span>
                      {opening === u.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div role="tablist" aria-label="Conversation type" className="flex flex-wrap gap-1.5">
            {[null, ...CHAT_KINDS].map((k) => (
              <button key={k ?? 'all'} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setLoading(true); }}
                className={clsx('pill', kind === k ? 'tone-active' : 'hover:border-neutral-400')}>
                {k ? CHAT_KIND_LABEL[k] : 'All'}{k && !kind ? <span className="tabular-nums text-neutral-500"> {counts[k]}</span> : null}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, product or order #" aria-label="Search conversations" className="input py-2 pl-9" />
          </div>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-live="polite" aria-busy={loading}>
          {error && <li className="px-3 py-4 text-sm text-red-600">{error}</li>}
          {!error && loading && <li className="grid place-items-center py-10 text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></li>}
          {!error && !loading && threads.length === 0 && <li className="px-3 py-10 text-center text-sm text-neutral-500">No conversations match.</li>}
          {threads.map((t) => (
            <li key={t.thread_id}>
              <button type="button" onClick={() => select(t.thread_id)} aria-current={t.thread_id === selectedId ? 'true' : undefined}
                className={clsx('press w-full rounded-lg border px-3 py-2.5 text-left', t.thread_id === selectedId ? 'border-neutral-300 bg-neutral-100' : 'border-transparent hover:bg-neutral-50')}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-neutral-900">{adminThreadParties(t)}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">{formatChatTime(t.last_message_at ?? t.updated_at)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className={clsx('pill py-0 text-[10px]', t.kind === 'direct' ? 'tone-active' : t.kind === 'order' ? 'tone-transit' : 'tone-muted')}>{CHAT_KIND_LABEL[t.kind].replace(/s$/, '')}</span>
                  <span className="truncate text-xs font-semibold text-neutral-800">{t.title}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-neutral-500">
                    {t.last_from_admin && <ShieldCheck className="mr-1 inline h-3 w-3 text-blue-600" aria-label="Admin" />}
                    {t.last_message ?? 'No messages yet'}
                  </span>
                  {t.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold tabular-nums text-snow" aria-label={`${t.unread_count} unread`}>{t.unread_count}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Conversation" className={clsx('min-h-[28rem] min-w-0 flex-col', selectedId ? 'flex' : 'hidden lg:flex')}>
        {selectedId ? (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
              <button type="button" onClick={() => select(null)} aria-label="Back to conversations" className="press mr-1 rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 lg:hidden">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-neutral-900">{selected ? adminThreadParties(selected) : 'Conversation'}</h2>
                <p className="truncate text-xs text-neutral-500">
                  {selected?.title}{selected?.kind !== 'direct' ? ' · you are viewing as SokoGlobal; your replies are marked Admin' : ''}
                </p>
              </div>
              {selected?.order_id && (
                <Link href={`/admin/orders/${selected.order_id}/tracking`} className="btn-secondary px-2.5 py-1.5 text-xs">Order <ExternalLink className="h-3 w-3" aria-hidden /></Link>
              )}
            </header>
            <ChatThread key={selectedId} threadId={selectedId} onRead={async () => { await refreshUnread(); void load(); }} className="min-h-0 flex-1" />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <MessageCircle className="h-8 w-8 text-neutral-300" strokeWidth={1.5} aria-hidden />
            <p className="mt-3 font-medium text-neutral-900">Pick a conversation</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500">Or search for a buyer or supplier above to start a direct support thread.</p>
          </div>
        )}
      </section>
    </div>
  );
}
