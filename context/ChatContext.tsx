'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { pickChannelName, type ChatThreadSummary } from '@/lib/chat';
import ChatDrawer from '@/components/chat/ChatDrawer';

interface ChatState {
  /** Total unread messages for the signed-in importer/supplier (0 otherwise). */
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  /** Get-or-create the caller's thread about a product, then open it in the drawer. */
  openForProduct: (productId: string, productTitle: string) => Promise<void>;
  openThread: (threadId: string, title?: string, counterpartName?: string) => void;
  close: () => void;
  activeThreadId: string | null;
  /** True while openForProduct is starting a thread. */
  starting: boolean;
  /** Last openForProduct error (also shown as a toast). */
  error: string | null;
}

const ChatContext = createContext<ChatState | undefined>(undefined);

const errorMessage = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message ? err.message : fallback;

export function ChatProvider({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const role = profile?.role ?? null;
  const enabled = !!userId && (role === 'importer' || role === 'supplier');

  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [counterpartName, setCounterpartName] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeThreadId;

  const refreshUnread = useCallback(async () => {
    if (!enabledRef.current) { setUnreadCount(0); return; }
    const { data, error: rpcError } = await supabase.rpc('chat_unread_count');
    if (!rpcError && enabledRef.current) setUnreadCount(typeof data === 'number' ? data : 0);
  }, [supabase]);

  // Unread badge: fetch on sign-in, then re-fetch on every message insert we can see (RLS-filtered).
  useEffect(() => {
    if (!enabled) { setUnreadCount(0); return; }
    void refreshUnread();
    const name = pickChannelName('messages', supabase.getChannels().map((c) => c.topic));
    const channel = supabase
      .channel(name)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => { void refreshUnread(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, userId, supabase, refreshUnread]);

  // Signing out (or switching account) closes the drawer.
  useEffect(() => {
    if (!enabled) { setOpen(false); setActiveThreadId(null); }
  }, [enabled, userId]);

  // Fill in the counterpart's name when it isn't known (opened from a product).
  const lookupCounterpart = useCallback(async (threadId: string) => {
    const { data } = await supabase.rpc('my_chat_threads');
    const row = ((data ?? []) as ChatThreadSummary[]).find((t) => t.thread_id === threadId);
    if (row && activeRef.current === threadId) {
      setCounterpartName(row.counterpart_name);
      setTitle((t) => t ?? row.product_title);
    }
  }, [supabase]);

  const openThread = useCallback((threadId: string, threadTitle?: string, counterpart?: string) => {
    activeRef.current = threadId;
    setActiveThreadId(threadId);
    setTitle(threadTitle ?? null);
    setCounterpartName(counterpart ?? null);
    setError(null);
    setOpen(true);
    if (!counterpart || !threadTitle) void lookupCounterpart(threadId);
  }, [lookupCounterpart]);

  const openForProduct = useCallback(async (productId: string, productTitle: string) => {
    setStarting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('start_chat_thread', { p_product_id: productId });
      if (rpcError) throw rpcError;
      const thread = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
      if (!thread?.id) throw new Error('Could not start the conversation');
      openThread(thread.id, productTitle);
    } catch (err) {
      const message = errorMessage(err, 'Could not start the conversation');
      setError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  }, [supabase, openThread]);

  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<ChatState>(() => ({
    unreadCount: enabled ? unreadCount : 0,
    refreshUnread, openForProduct, openThread, close,
    activeThreadId: open ? activeThreadId : null,
    starting, error,
  }), [enabled, unreadCount, refreshUnread, openForProduct, openThread, close, open, activeThreadId, starting, error]);

  return (
    <ChatContext.Provider value={value}>
      {children}
      {enabled && (
        <ChatDrawer
          open={open && !!activeThreadId}
          threadId={activeThreadId}
          title={title}
          counterpartName={counterpartName}
          inboxPath={role === 'supplier' ? '/supplier/messages' : '/dashboard/messages'}
          onClose={close}
          onRead={refreshUnread}
        />
      )}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
