'use client';

import { MessageCircle } from 'lucide-react';
import { openSupport } from '@/lib/support-events';

/** Opens the support widget on this order's chat (cancelled, refunded or disputed orders). */
export default function OrderSupportButton({ orderId, label = 'Get help' }: { orderId: string; label?: string }) {
  return (
    <button type="button" onClick={() => openSupport({ orderId })} className="btn-secondary px-3.5 py-2">
      <MessageCircle className="h-4 w-4" /> {label}
    </button>
  );
}
