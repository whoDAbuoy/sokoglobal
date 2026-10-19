/**
 * Pure helpers for the portal messaging hub (buyer ⇄ supplier chat). No React,
 * no Supabase. Works on rows returned by my_chat_threads().
 */
import type { ChatThreadSummary } from './chat';

export const CHAT_BOXES = ['inbox', 'unread', 'awaiting', 'sent', 'muted'] as const;
export type ChatBox = (typeof CHAT_BOXES)[number];

export const CHAT_BOX_LABEL: Record<'importer' | 'supplier', Record<ChatBox, string>> = {
  importer: { inbox: 'All suppliers', unread: 'Unread', awaiting: 'Supplier replied', sent: 'Waiting on supplier', muted: 'Muted' },
  supplier: { inbox: 'All buyers', unread: 'Unread', awaiting: 'Needs your reply', sent: 'Waiting on buyer', muted: 'Muted' },
};

export function parseChatBox(v: string | null | undefined): ChatBox {
  return (CHAT_BOXES as readonly string[]).includes(v ?? '') ? (v as ChatBox) : 'inbox';
}

/** Does a thread belong in a mailbox? "awaiting" = the other side spoke last; "sent" = you did. */
export function inChatBox(t: ChatThreadSummary, box: ChatBox, myId: string | null, muted: readonly string[]): boolean {
  const isMuted = muted.includes(t.thread_id);
  switch (box) {
    case 'inbox': return true;
    case 'unread': return t.unread_count > 0;
    case 'awaiting': return !!t.last_message && t.last_sender_id !== null && t.last_sender_id !== myId;
    case 'sent': return !!t.last_message && t.last_sender_id === myId;
    case 'muted': return isMuted;
  }
}

export function chatBoxCounts(threads: readonly ChatThreadSummary[], myId: string | null, muted: readonly string[]): Record<ChatBox, number> {
  const c = { inbox: 0, unread: 0, awaiting: 0, sent: 0, muted: 0 } as Record<ChatBox, number>;
  for (const t of threads) for (const b of CHAT_BOXES) if (inChatBox(t, b, myId, muted)) c[b] += 1;
  return c;
}

/** Product "labels": the products people are talking about, busiest first (max `limit`). */
export function productLabels(threads: readonly ChatThreadSummary[], limit = 6): { key: string; title: string; count: number; unread: number }[] {
  const m = new Map<string, { key: string; title: string; count: number; unread: number }>();
  for (const t of threads) {
    const key = t.product_id ?? `title:${t.product_title}`;
    const e = m.get(key) ?? { key, title: t.product_title, count: 0, unread: 0 };
    e.count += 1;
    e.unread += t.unread_count;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.unread - a.unread || b.count - a.count || a.title.localeCompare(b.title)).slice(0, limit);
}

export function labelKey(t: ChatThreadSummary): string {
  return t.product_id ?? `title:${t.product_title}`;
}

/** Filter + search (product, counterpart, last message), newest activity first. */
export function filterThreads(
  threads: readonly ChatThreadSummary[],
  opts: { box: ChatBox; label: string | null; query: string; myId: string | null; muted: readonly string[] },
): ChatThreadSummary[] {
  const q = opts.query.trim().toLowerCase();
  return threads
    .filter((t) => inChatBox(t, opts.box, opts.myId, opts.muted)
      && (!opts.label || labelKey(t) === opts.label)
      && (!q || t.product_title.toLowerCase().includes(q) || t.counterpart_name.toLowerCase().includes(q) || (t.last_message ?? '').toLowerCase().includes(q)))
    .sort((a, b) => Date.parse(b.last_message_at ?? b.updated_at) - Date.parse(a.last_message_at ?? a.updated_at));
}

/** Status dot: amber = unread / your turn, emerald = waiting on the other side, neutral = no messages. */
export function threadDot(t: ChatThreadSummary, myId: string | null): { className: string; label: string } {
  if (t.unread_count > 0) return { className: 'bg-amber-500', label: `${t.unread_count} unread` };
  if (!t.last_message) return { className: 'bg-neutral-400', label: 'No messages yet' };
  if (t.last_sender_id === myId) return { className: 'bg-emerald-500', label: 'Waiting for a reply' };
  return { className: 'bg-cyan-500', label: 'Read' };
}
