'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Copy, MoreVertical, Package, Plane } from 'lucide-react';
import { toast } from 'sonner';

/** Three-dot menu for a transaction row. Links only — every write still goes through the existing admin pages. */
export default function RowActions({ orderId, productTitle, canTrack }: {
  orderId: string; productTitle: string | null; canTrack: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const copy = async () => {
    setOpen(false);
    try { await navigator.clipboard.writeText(orderId); toast.success('Order ID copied'); }
    catch { toast.error('Could not copy the order ID'); }
  };

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900';
  return (
    <div ref={ref} className="relative inline-block text-left">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Actions for order ${orderId.slice(0, 8).toUpperCase()}`}
        className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
        <MoreVertical className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-52 animate-fade-in overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-overlay">
          {canTrack && (
            <Link role="menuitem" href={`/admin/orders/${orderId}/tracking`} className={item} onClick={() => setOpen(false)}>
              <Plane className="h-4 w-4" aria-hidden /> Update shipment
            </Link>
          )}
          {productTitle && (
            <Link role="menuitem" href={`/admin/products?q=${encodeURIComponent(productTitle.slice(0, 100))}`} className={item} onClick={() => setOpen(false)}>
              <Package className="h-4 w-4" aria-hidden /> Review product
            </Link>
          )}
          <button role="menuitem" type="button" onClick={copy} className={item}>
            <Copy className="h-4 w-4" aria-hidden /> Copy order ID
          </button>
        </div>
      )}
    </div>
  );
}
