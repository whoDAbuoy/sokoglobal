'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Loader2, Power } from 'lucide-react';
import { savePlatformSettings } from '@/app/admin/control/actions';
import type { PlatformSettings } from '@/lib/platform';

const SWITCHES = [
  ['pauseNewOrders', 'Pause new orders', 'Buyers cannot create orders, carts or Trend Pool pledges. Existing orders, payouts and webhooks keep running.'],
  ['pauseCheckout', 'Halt checkout', 'No new card or M-Pesa payments start. Orders already placed stay saved for later.'],
  ['maintenance', 'Maintenance mode', 'Everyone except admins sees the maintenance page; API calls return 503. Webhooks and cron are unaffected.'],
] as const;

/** Global kill switch. Only permanent admins can save (re-checked by admin_set_platform_settings in SQL). */
export default function PlatformSwitches({ settings, canEdit }: { settings: PlatformSettings; canEdit: boolean }) {
  const router = useRouter();
  const [state, setState] = useState({
    pauseNewOrders: settings.pause_new_orders, pauseCheckout: settings.pause_checkout, maintenance: settings.maintenance_mode,
  });
  const [banner, setBanner] = useState(settings.banner_message ?? '');
  const [pending, start] = useTransition();
  const dirty = state.pauseNewOrders !== settings.pause_new_orders || state.pauseCheckout !== settings.pause_checkout
    || state.maintenance !== settings.maintenance_mode || banner.trim() !== (settings.banner_message ?? '');

  const save = () => start(async () => {
    if (state.maintenance && !settings.maintenance_mode && !window.confirm('Turn on maintenance mode? Every non-admin is locked out until you turn it off.')) return;
    const res = await savePlatformSettings({ ...state, banner });
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) router.refresh();
  });

  return (
    <div>
      <ul className="divide-y divide-neutral-200">
        {SWITCHES.map(([key, label, hint]) => {
          const on = state[key];
          return (
            <li key={key} className="flex items-start justify-between gap-4 py-3.5">
              <div>
                <p id={`sw-${key}`} className="text-sm font-medium text-neutral-900">{label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{hint}</p>
              </div>
              <button type="button" role="switch" aria-checked={on} aria-labelledby={`sw-${key}`} disabled={!canEdit || pending}
                onClick={() => setState((s) => ({ ...s, [key]: !s[key] }))}
                className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50',
                  on ? 'bg-rose-600' : 'bg-neutral-300')}>
                <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-snow shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </li>
          );
        })}
      </ul>
      <label htmlFor="banner" className="label mt-3">Banner message (optional, shown site-wide)</label>
      <input id="banner" value={banner} onChange={(e) => setBanner(e.target.value)} maxLength={300} disabled={!canEdit} className="input"
        placeholder="e.g. Checkout resumes at 14:00 EAT after a payment-provider upgrade." />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">{canEdit ? 'Changes are written to the audit log with your IP address.' : 'Read-only: temporary admins cannot change platform switches.'}</p>
        {canEdit && (
          <button type="button" onClick={save} disabled={!dirty || pending} className="btn-primary px-4 py-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />} Save switches
          </button>
        )}
      </div>
    </div>
  );
}
