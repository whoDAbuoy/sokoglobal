/**
 * Pure helpers for the admin Support hub (no React, no Supabase).
 * Contract: support_tickets / support_messages in
 * supabase/migrations/003_payouts_refunds_kyc_support.sql.
 */

export type TicketStatus = 'open' | 'awaiting_customer' | 'resolved';
export type TicketCategory = 'order_inquiry' | 'dispute' | 'payment' | 'shipping' | 'other';

/** Mailboxes in the left column. Each is a view over ticket status/category. */
export const MAILBOXES = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'needs_reply', label: 'Needs reply' },
  { id: 'awaiting', label: 'Awaiting customer' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'resolved', label: 'Resolved' },
] as const;
export type MailboxId = (typeof MAILBOXES)[number]['id'];

export const LABELS: { id: TicketCategory; label: string; dot: string }[] = [
  { id: 'order_inquiry', label: 'Orders', dot: 'bg-sky-500' },
  { id: 'payment', label: 'Payments', dot: 'bg-emerald-500' },
  { id: 'shipping', label: 'Shipping', dot: 'bg-violet-500' },
  { id: 'dispute', label: 'Disputes', dot: 'bg-red-500' },
  { id: 'other', label: 'Other', dot: 'bg-neutral-400' },
];

export function parseMailbox(v: string | undefined): MailboxId {
  return MAILBOXES.some((m) => m.id === v) ? (v as MailboxId) : 'inbox';
}
export function parseLabel(v: string | undefined): TicketCategory | null {
  return LABELS.some((l) => l.id === v) ? (v as TicketCategory) : null;
}

export interface TicketLike { status: TicketStatus; category: TicketCategory }

/** Does a ticket belong in a mailbox? "Inbox" = every unresolved conversation. */
export function inMailbox(t: TicketLike, box: MailboxId): boolean {
  switch (box) {
    case 'inbox': return t.status !== 'resolved';
    case 'needs_reply': return t.status === 'open';
    case 'awaiting': return t.status === 'awaiting_customer';
    case 'disputes': return t.category === 'dispute' && t.status !== 'resolved';
    case 'resolved': return t.status === 'resolved';
  }
}

/** Badge counts: mailboxes count their tickets; labels count unresolved tickets per category. */
export function inboxCounts(tickets: readonly TicketLike[]) {
  const boxes = Object.fromEntries(MAILBOXES.map((m) => [m.id, 0])) as Record<MailboxId, number>;
  const labels = Object.fromEntries(LABELS.map((l) => [l.id, 0])) as Record<TicketCategory, number>;
  for (const t of tickets) {
    for (const m of MAILBOXES) if (inMailbox(t, m.id)) boxes[m.id] += 1;
    if (t.status !== 'resolved') labels[t.category] += 1;
  }
  return { boxes, labels };
}

/** Status dot: orange = needs a reply, green = active (waiting on customer), gray = resolved. Disputes are red. */
export function statusDot(t: TicketLike): { className: string; label: string } {
  if (t.status === 'resolved') return { className: 'bg-neutral-400', label: 'Resolved' };
  if (t.category === 'dispute') return { className: 'bg-red-500', label: t.status === 'open' ? 'Dispute · needs reply' : 'Dispute · awaiting customer' };
  if (t.status === 'open') return { className: 'bg-amber-500', label: 'Needs reply' };
  return { className: 'bg-emerald-500', label: 'Awaiting customer' };
}

/** Disputes first, then most recent activity. */
export function sortTickets<T extends TicketLike & { last_message_at: string }>(tickets: readonly T[]): T[] {
  return [...tickets].sort((a, b) =>
    Number(b.category === 'dispute' && b.status !== 'resolved') - Number(a.category === 'dispute' && a.status !== 'resolved')
    || Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
}

/** "Acme Imports Ltd" → "AI". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** "just now", "5 min ago", "2 hours ago", "Yesterday", "Oct 16". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const d = new Date(t);
  const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
  if (d.getUTCFullYear() === y.getUTCFullYear() && d.getUTCMonth() === y.getUTCMonth() && d.getUTCDate() === y.getUTCDate()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC',
    ...(d.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}) });
}

/** One-line preview of a message body. */
export function snippet(body: string | null | undefined, max = 90): string {
  const s = (body ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Split a thread into collapsed history and the visible tail. */
export function splitHistory<T>(messages: readonly T[], visible = 3): { earlier: T[]; recent: T[] } {
  if (messages.length <= visible) return { earlier: [], recent: [...messages] };
  return { earlier: messages.slice(0, messages.length - visible), recent: messages.slice(-visible) };
}

/** Muted thread ids are a per-browser preference (stored client-side, never in the database). */
export function toggleMuted(ids: readonly string[], id: string, muted: boolean): string[] {
  const set = new Set(ids);
  if (muted) set.add(id); else set.delete(id);
  return [...set].slice(-500);
}
export function parseMuted(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
