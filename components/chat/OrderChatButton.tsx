'use client';

import clsx from 'clsx';
import { Loader2, MessagesSquare } from 'lucide-react';
import { useChat } from '@/context/ChatContext';

/**
 * Opens the order's chat (text, photos, video, documents, voice notes) in the chat drawer.
 * Only render it for a paid order: start_order_chat() refuses unpaid ones (migration 024).
 */
export default function OrderChatButton({ orderId, title, label = 'Order chat', className }: {
  orderId: string; title: string; label?: string; className?: string;
}) {
  const chat = useChat();
  return (
    <button type="button" disabled={chat.starting} onClick={() => void chat.openForOrder(orderId, title)}
      className={clsx('btn-secondary px-3 py-1.5 text-sm', className)}>
      {chat.starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessagesSquare className="h-4 w-4" aria-hidden />} {label}
    </button>
  );
}
