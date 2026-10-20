import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getPlatformSettings } from '@/lib/platform-server';

/**
 * Site-wide notice while the kill switch pauses orders or checkout (set in /admin/control).
 * Renders nothing when the platform is open. Any read error → nothing (never blocks a page).
 */
export default async function PlatformBanner() {
  let s;
  try { s = await getPlatformSettings(await createClient()); } catch { return null; }
  if (s.maintenance_mode || (!s.pause_new_orders && !s.pause_checkout && !s.banner_message)) return null;
  const status = s.pause_new_orders && s.pause_checkout ? 'Orders and checkout are paused.'
    : s.pause_new_orders ? 'New orders are paused.' : s.pause_checkout ? 'Checkout is paused; saved orders can be paid later.' : null;
  return (
    <div role="status" className="relative z-[60] flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{[status, s.banner_message].filter(Boolean).join(' ')}</span>
    </div>
  );
}
