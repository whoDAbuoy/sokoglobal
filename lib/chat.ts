/**
 * Pure chat helpers (no React, no Supabase) shared by the chat UI.
 * Contract: supabase/migrations/009_realtime_chat.sql.
 */

export const MAX_MESSAGE_LENGTH = 4000;

/** Columns the chat UI selects (message_type / metadata: migration 024). */
export const CHAT_MESSAGE_COLUMNS = 'id, thread_id, sender_id, content, created_at, read_at, message_type, metadata, from_admin';

/** message_type (migration 024). Attachments are only allowed in order chats. */
export type ChatMessageType = 'text' | 'image' | 'video' | 'document' | 'voice_note';

/** Attachment details, rebuilt server-side from the stored object (migration 024). */
export interface ChatMessageMetadata {
  size?: number;
  mime_type?: string;
  file_name?: string;
  duration_seconds?: number;
  /** Voice notes: up to 64 peaks, 0–100. */
  waveform?: number[];
}

/** A row of public.chat_messages as the client selects it. For attachments, content is the storage path. */
export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  /** Absent on rows from before migration 024 (= text). */
  message_type?: ChatMessageType;
  metadata?: ChatMessageMetadata | null;
  /** Sent by a SokoGlobal super admin (set by the database, migration 025). */
  from_admin?: boolean;
}

/** product: about a listing (009) · order: about one order (024) · direct: SokoGlobal support ↔ one user (025). */
export type ChatThreadKind = 'product' | 'order' | 'direct';

/** A row returned by the my_chat_threads() RPC. */
export interface ChatThreadSummary {
  thread_id: string;
  product_id: string | null;
  product_title: string;
  /** 'user' / 'admin' in direct support threads (migration 025). */
  my_role: 'buyer' | 'supplier' | 'user' | 'admin';
  counterpart_id: string;
  counterpart_name: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  unread_count: number;
  updated_at: string;
  /** Set for order chats (migration 024). */
  order_id?: string | null;
  /** Migration 025. */
  kind?: ChatThreadKind;
  /** The latest message came from a SokoGlobal admin. */
  last_from_admin?: boolean;
}

export type MessageValidation = { ok: true; content: string } | { ok: false; error: string };

/** Mirrors the database check: content is trimmed and must be 1–4000 characters. */
export function validateMessage(text: string | null | undefined): MessageValidation {
  const content = (text ?? '').trim();
  if (!content) return { ok: false, error: 'Type a message first.' };
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Messages can be at most ${MAX_MESSAGE_LENGTH.toLocaleString('en-GB')} characters (currently ${content.length.toLocaleString('en-GB')}).` };
  }
  return { ok: true, content };
}

/**
 * Merge message lists, de-duplicated by id and sorted by created_at (then id).
 * The sender receives both the insert response and the realtime echo, so the
 * same message can arrive twice. Later copies win, except a read receipt is
 * never cleared (read_at only ever goes from null to a timestamp).
 */
export function mergeMessages(existing: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev && !m.read_at && prev.read_at ? { ...m, read_at: prev.read_at } : m);
  }
  return [...byId.values()].sort((a, b) => {
    const d = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Compact timestamp for chat lists/bubbles (local time, en-GB):
 * "14:05" today, "Mon" within the last 6 days, "12 Oct" this year, "12 Oct 2024" older.
 */
export function formatChatTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  if (days > 0 && days < 7) return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/**
 * Realtime channel name to use for `base`. supabase.channel() returns an
 * existing channel with the same topic, and one that is still leaving (React
 * StrictMode remount, or the same thread open in the drawer and the inbox)
 * can't take new postgres_changes listeners. So add a suffix when taken.
 * `existingTopics` are RealtimeChannel.topic values ("realtime:<name>").
 */
export function pickChannelName(base: string, existingTopics: readonly string[]): string {
  const taken = new Set(existingTopics.map((t) => t.replace(/^realtime:/, '')));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}#${i}`)) return `${base}#${i}`;
}
