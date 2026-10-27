'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { inAppNotification } from '@/lib/notifications/templates';

/**
 * Header bell: order, payment, quote, KYC and support updates for the signed-in user
 * (user_notifications, migration 037). The badge counts unread items and updates live (Realtime);
 * opening the panel loads the latest 30 and marks them read. If they can't be read, the panel says
 * notifications aren't available right now instead of failing.
 */
interface Row { id: string; template_key: string; payload: Record<string, unknown>; created_at: string; read_at: string | null }

const LIMIT = 30;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso: string, now = Date.now()): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]];
  let v = s;
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return unit === 'second' ? 'just now' : rtf.format(Math.round(v), unit);
    v /= size;
  }
  return '';
}

export default function NotificationBell({ userId, className }: { userId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'unavailable'>('idle');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const refreshCount = useCallback(async () => {
    const { count, error } = await createClient().from('user_notifications')
      .select('id', { count: 'exact', head: true }).is('read_at', null);
    if (!error) setUnread(count ?? 0);
  }, []);

  // Unread count on load, then live: a new notification bumps the badge (and the list, if open).
  useEffect(() => {
    void refreshCount();
    const supabase = createClient();
    const channel = supabase.channel(`user-notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` }, (msg) => {
        const row = msg.new as Row;
        setUnread((n) => n + 1);
        setRows((list) => (list ? [row, ...list].slice(0, LIMIT) : list));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, refreshCount]);

  const load = useCallback(async () => {
    setState('loading');
    const supabase = createClient();
    const { data, error } = await supabase.from('user_notifications')
      .select('id, template_key, payload, created_at, read_at').order('created_at', { ascending: false }).limit(LIMIT);
    if (error) { setState(/relation|does not exist|schema cache/i.test(error.message) ? 'unavailable' : 'error'); return; }
    setRows((data ?? []) as Row[]);
    setState('idle');
    if ((data ?? []).some((r) => !r.read_at)) {
      const { error: markError } = await supabase.rpc('mark_notifications_read');
      if (!markError) setUnread(0);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);

  return (
    <div className="relative">
      <button ref={buttonRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className={className}>
        <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold tabular-nums text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} id={panelId} role="region" aria-label="Notifications"
          className="frost-panel absolute right-0 top-full z-50 mt-2 flex max-h-[min(32rem,calc(100dvh-6rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-black/[0.06] text-neutral-900 shadow-2xl dark:border-snow/10">
          <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3 dark:border-snow/[0.08]">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <Link href="/dashboard/settings?tab=notifications" onClick={() => close(false)} className="text-xs text-neutral-500 hover:text-neutral-900">Email &amp; SMS settings</Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {state === 'loading' && !rows && (
              <p role="status" className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>
            )}
            {state === 'error' && (
              <p role="alert" className="px-4 py-10 text-center text-sm text-neutral-600">
                Couldn&apos;t load notifications. <button type="button" onClick={() => void load()} className="font-medium underline">Try again</button>
              </p>
            )}
            {state === 'unavailable' && (
              <p className="px-4 py-10 text-center text-sm text-neutral-600">Notifications aren&apos;t switched on yet. Check back soon.</p>
            )}
            {rows && rows.length === 0 && state === 'idle' && (
              <div className="px-4 py-10 text-center">
                <BellOff className="mx-auto h-6 w-6 text-neutral-400" aria-hidden />
                <p className="mt-2 text-sm text-neutral-600">No notifications yet. Order, payment and quote updates will show up here.</p>
              </div>
            )}
            {rows && rows.length > 0 && (
              <ul className="divide-y divide-black/[0.06] dark:divide-snow/[0.08]">
                {rows.map((r) => {
                  const n = inAppNotification(r.template_key, r.payload ?? {});
                  const body = (
                    <>
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-sm font-medium text-neutral-900">{n.title}</span>
                        {!r.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5a9895]" aria-label="New" />}
                      </span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-600">{n.body}</span>}
                      <time dateTime={r.created_at} className="mt-1 block text-[11px] text-neutral-500">{ago(r.created_at)}</time>
                    </>
                  );
                  return (
                    <li key={r.id}>
                      {n.href
                        ? <Link href={n.href} onClick={() => close(false)} className="block px-4 py-3 hover:bg-neutral-900/[0.04] focus-visible:bg-neutral-900/[0.04] focus-visible:outline-none dark:hover:bg-snow/[0.06]">{body}</Link>
                        : <div className="px-4 py-3">{body}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
