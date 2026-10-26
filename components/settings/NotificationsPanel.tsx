'use client';

import { useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { setNotificationPref } from '@/app/dashboard/settings/actions';
import type { NotificationPref } from '@/lib/settings';

export type NotificationPrefs = Record<NotificationPref, boolean>;

const ROWS: { key: NotificationPref; label: string; hint: string }[] = [
  { key: 'email_notifications', label: 'Email alerts', hint: 'Payment receipts, escrow releases, disputes and account notices.' },
  { key: 'sms_alerts', label: 'WhatsApp / SMS alerts', hint: 'Short alerts to your phone for payments and deliveries. Needs a phone number on the Profile tab.' },
  { key: 'order_status_updates', label: 'Real-time order updates', hint: 'Shipment milestones (departed, customs cleared, out for delivery) as they happen.' },
];

/** Each switch saves on its own, straight away; it flips back if the save fails. */
export default function NotificationsPanel({ prefs, hasPhone, disabled }: { prefs: NotificationPrefs; hasPhone: boolean; disabled?: boolean }) {
  const [view, setView] = useOptimistic(prefs, (s, p: { key: NotificationPref; value: boolean }) => ({ ...s, [p.key]: p.value }));
  const [pending, start] = useTransition();

  const flip = (key: NotificationPref) => start(async () => {
    const value = !view[key];
    setView({ key, value });
    const res = await setNotificationPref(key, value);
    if (res.ok) toast.success(`${ROWS.find((r) => r.key === key)!.label} ${value ? 'on' : 'off'}`);
    else toast.error(res.message);
  });

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-900">Notifications</h3>
      <p className="mt-1 text-sm text-neutral-600">Choose how SokoGlobal reaches you. Account emails such as password resets are always sent.</p>
      <ul className="mt-5 divide-y divide-neutral-200 rounded-3xl border border-neutral-200">
        {ROWS.map(({ key, label, hint }) => {
          const on = view[key];
          const locked = disabled || (key === 'sms_alerts' && !hasPhone && !on);
          return (
            <li key={key} className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p id={`np-${key}`} className="text-sm font-medium text-neutral-900">{label}</p>
                <p id={`np-${key}-hint`} className="mt-0.5 text-xs leading-relaxed text-neutral-600">{hint}</p>
              </div>
              <button type="button" role="switch" aria-checked={on} aria-labelledby={`np-${key}`} aria-describedby={`np-${key}-hint`}
                disabled={locked || pending} onClick={() => flip(key)}
                className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
                  on ? 'bg-blue-600' : 'bg-neutral-300')}>
                <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-snow shadow transition-transform motion-reduce:transition-none', on ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
