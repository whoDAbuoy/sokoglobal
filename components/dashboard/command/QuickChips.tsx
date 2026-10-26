'use client';

import Link from 'next/link';
import { FileQuestion, Heart, MessageSquare, Package, ShoppingBag, Compass, type LucideIcon } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useChat } from '@/context/ChatContext';
import { useWishlist } from '@/hooks/useWishlist';

/**
 * Quick actions as high-contrast glass chips with live counts: orders and open RFQs come from the server page;
 * cart, wishlist and unread messages from the client stores the header already uses.
 */
export default function QuickChips({ orders, openRfqs }: { orders: number; openRfqs: number | null }) {
  const cart = useCart();
  const saved = useWishlist().ids.length;
  const { unreadCount } = useChat();
  const chips: { href?: string; onClick?: () => void; label: string; icon: LucideIcon; count?: number | null }[] = [
    { href: '/dashboard/orders', label: 'Orders', icon: Package, count: orders },
    { href: '/dashboard/rfqs', label: 'RFQs', icon: FileQuestion, count: openRfqs },
    { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare, count: unreadCount },
    { href: '/dashboard/wishlist', label: 'Wishlist', icon: Heart, count: saved },
    { onClick: () => cart.setOpen(true), label: 'Cart', icon: ShoppingBag, count: cart.items.length },
    { href: '/dashboard/discover', label: 'Catalogue', icon: Compass },
  ];
  const cls = 'press group flex items-center gap-2.5 rounded-2xl border border-snow/10 bg-snow/[0.04] px-3 py-2.5 text-left transition-all hover:border-[#5a9895]/50 hover:bg-[#5a9895]/10 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]';
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2">
      {chips.map(({ href, onClick, label, icon: Icon, count }) => {
        const inner = (
          <>
            <Icon className="h-4 w-4 shrink-0 text-[#8fd3cc]" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{label}</span>
            {count ? <span className="sx-pill sx-pill-mint px-2 py-0.5" aria-label={`${count} ${label.toLowerCase()}`}>{count > 99 ? '99+' : count}</span> : null}
          </>
        );
        return href
          ? <Link key={label} href={href} className={cls}>{inner}</Link>
          : <button key={label} type="button" onClick={onClick} className={cls}>{inner}</button>;
      })}
    </nav>
  );
}
