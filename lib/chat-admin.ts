/**
 * Chat rules shared by the UI (pure). Contract: migrations 024 and 025 —
 * is_order_chat_participant(), chat_attachment_access(), admin_chat_threads().
 */
import type { ChatThreadKind } from './chat';
import type { EscrowStatus } from './types';

export const CHAT_KIND_LABEL: Record<ChatThreadKind, string> = { order: 'Order chats', product: 'Product inquiries', direct: 'Direct support' };
export const CHAT_KINDS: ChatThreadKind[] = ['order', 'product', 'direct'];

export function parseChatKind(v: unknown): ChatThreadKind | null {
  return v === 'order' || v === 'product' || v === 'direct' ? v : null;
}

/**
 * Can this order have a chat yet? Paid orders (anything past awaiting payment that
 * wasn't cancelled unpaid), plus accepted RFQ quotes awaiting payment — the
 * supplier already knows that order because they quoted it.
 */
export function orderChatOpen(o: { escrow_status: EscrowStatus; funded_at?: string | null; deposit_paid_at?: string | null; rfq_quote_id?: string | null }): boolean {
  if (o.escrow_status === 'pending_payment') return !!o.rfq_quote_id;
  if (o.escrow_status === 'cancelled') return !!(o.funded_at || o.deposit_paid_at);
  return true;
}

/** First folder of an attachment path: order threads keep the order id (024), every other thread uses its own id. */
export const attachmentScope = (thread: { id: string; order_id?: string | null }) => thread.order_id ?? thread.id;

/** One row of admin_chat_threads(). */
export interface AdminChatThread {
  thread_id: string; kind: ChatThreadKind; title: string; order_id: string | null; product_id: string | null;
  buyer_name: string | null; supplier_name: string | null; user_id: string | null; user_name: string | null; user_role: string | null;
  last_message: string | null; last_message_at: string | null; last_from_admin: boolean; unread_count: number; updated_at: string;
}

/** "Buyer Co ↔ Supplier Co" for buyer–supplier threads, the user's name for support threads. */
export function adminThreadParties(t: Pick<AdminChatThread, 'kind' | 'buyer_name' | 'supplier_name' | 'user_name'>): string {
  if (t.kind === 'direct') return t.user_name ?? 'User';
  return `${t.buyer_name ?? 'Buyer'} ↔ ${t.supplier_name ?? 'Supplier'}`;
}
