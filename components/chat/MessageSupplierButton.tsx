'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChat } from '@/context/ChatContext';

const LINK_CLASS = 'inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline disabled:cursor-not-allowed disabled:opacity-50';

/** "Message supplier" for importers (sign-in link when signed out; nothing for suppliers/admins). */
export default function MessageSupplierButton({ productId, productTitle, disabled, className, variant = 'button' }: {
  productId: string;
  productTitle: string;
  disabled?: boolean;
  className?: string;
  variant?: 'button' | 'link';
}) {
  const { user, profile, loading } = useAuth();
  const chat = useChat();
  const pathname = usePathname();
  const cls = clsx(variant === 'link' ? LINK_CLASS : 'btn-secondary', className);

  if (loading) return null;
  if (!user) {
    return (
      <Link href={`/login?redirectTo=${encodeURIComponent(pathname || '/dashboard')}`} onClick={(e) => e.stopPropagation()} className={cls}>
        <MessageCircle className="h-4 w-4" /> Message supplier
      </Link>
    );
  }
  if (profile?.role !== 'importer') return null;

  return (
    <button type="button" disabled={disabled || chat.starting} className={cls}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); void chat.openForProduct(productId, productTitle); }}>
      {chat.starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Message supplier
    </button>
  );
}
