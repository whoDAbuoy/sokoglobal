'use client';

import { toast } from 'sonner';
import { Share2 } from 'lucide-react';
import { rfqShareUrl } from '@/lib/rfq';

/**
 * Share a request: the Web Share sheet where available (phones), otherwise
 * copy /rfqs/<id> to the clipboard. Recipients must sign in to open it.
 */
export default function ShareRFQButton({ rfqId, title, className = 'btn-secondary px-3 py-1.5 text-sm' }: { rfqId: string; title: string; className?: string }) {
  async function share() {
    const url = rfqShareUrl(window.location.origin, rfqId);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `RFQ: ${title}`, text: `Buyer request on SokoGlobal: ${title}`, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;   // user closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', { description: 'Anyone with a SokoGlobal account can open it.' });
    } catch {
      toast.error('Could not copy the link', { description: url });
    }
  }

  return (
    <button type="button" onClick={() => void share()} className={className}>
      <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
    </button>
  );
}
