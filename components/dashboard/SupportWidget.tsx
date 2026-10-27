'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { Headset, HelpCircle, Loader2, MessageCircle, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { EscrowStatus, OrderView } from '@/lib/types';
import { OPEN_SUPPORT_EVENT, type OpenSupportDetail } from '@/lib/support-events';

// The panels (FAQ, chat, dispute: most of this widget's code) load the first time the widget opens.
const panelsLoading = () => (
  <p className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
  </p>
);
const HelpPanel = dynamic(() => import('./SupportWidgetPanels').then((m) => m.HelpPanel), { loading: panelsLoading });
const ChatPanel = dynamic(() => import('./SupportWidgetPanels').then((m) => m.ChatPanel), { loading: panelsLoading });
const DisputePanel = dynamic(() => import('./SupportWidgetPanels').then((m) => m.DisputePanel), { loading: panelsLoading });
const FaqModal = dynamic(() => import('./SupportWidgetPanels').then((m) => m.FaqModal));

const DISPUTABLE: EscrowStatus[] = ['deposit_paid', 'funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];

type Tab = 'help' | 'chat' | 'dispute';

/* -------------------------------------------------------------------------- */
/* Widget                                                                      */
/* -------------------------------------------------------------------------- */
export default function SupportWidget({ orders = [] }: { orders?: OrderView[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('help');
  const [faqOpen, setFaqOpen] = useState(false);
  const [chatOrderId, setChatOrderId] = useState<string>('');
  const [announcement, setAnnouncement] = useState('');
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ help: null, chat: null, dispute: null });
  const baseId = useId();

  const disputable = orders.filter((o) => DISPUTABLE.includes(o.escrow_status));
  const tabs: { id: Tab; label: string; icon: typeof HelpCircle }[] = [
    { id: 'help', label: 'Help', icon: HelpCircle },
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    ...(disputable.length ? [{ id: 'dispute' as const, label: 'Dispute', icon: ShieldAlert }] : []),
  ];

  const close = useCallback(() => { setOpen(false); launcherRef.current?.focus(); }, []);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open]);

  // Order cards can open the widget on that order's support chat (lib/support-events.ts).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { orderId, tab: openOn } = (e as CustomEvent<OpenSupportDetail>).detail ?? {};
      if (orderId) setChatOrderId(orderId);
      setTab(openOn ?? 'chat');
      setOpen(true);
    };
    window.addEventListener(OPEN_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, onOpen);
  }, []);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const idx = tabs.findIndex((t) => t.id === tab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  }

  return (
    <>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
        {open && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${baseId}-title`}
            onKeyDown={(e) => { if (e.key === 'Escape' && !faqOpen) close(); }}
            className="flex max-h-[min(36rem,calc(100vh-7rem))] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[18px] border border-black/[0.06] text-neutral-900 shadow-2xl frost-panel dark:border-snow/10"
          >
            <header className="flex items-center justify-between bg-brand-900 px-4 py-3 text-white">
              <div className="flex items-center gap-2.5">
                <span className="relative grid h-9 w-9 place-items-center rounded-full bg-white/10">
                  <Headset className="h-4 w-4" aria-hidden />
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-brand-900" />
                </span>
                <div>
                  <h2 id={`${baseId}-title`} className="text-sm font-semibold">Trade Support</h2>
                  <p className="text-xs text-brand-200">Mon–Sat · 08:00–20:00 WAT/EAT</p>
                </div>
              </div>
              <button type="button" onClick={close} aria-label="Close support" className="rounded p-1 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                <X className="h-4 w-4" />
              </button>
            </header>

            <p className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden /> Every payment is held in escrow until you verify delivery.
            </p>

            <div role="tablist" aria-label="Support options" className="flex border-b border-slate-200 px-2">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  ref={(el) => { tabRefs.current[id] = el; }}
                  role="tab"
                  id={`${baseId}-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`${baseId}-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={onTabKey}
                  className={clsx('flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:bg-slate-50 focus-visible:outline-none',
                    tab === id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800',
                    id === 'dispute' && tab !== id && 'text-red-600/80')}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
              {tab === 'help' && (
                <HelpPanel
                  onOpenFaq={() => setFaqOpen(true)}
                  onChat={() => setTab('chat')}
                  onDispute={disputable.length ? () => setTab('dispute') : undefined}
                />
              )}
              {tab === 'chat' && (
                <ChatPanel orders={orders} orderId={chatOrderId} onOrderChange={setChatOrderId} announce={setAnnouncement} />
              )}
              {tab === 'dispute' && (
                <DisputePanel
                  orders={disputable}
                  announce={setAnnouncement}
                  onOpened={(orderId) => { setChatOrderId(orderId); setTab('chat'); }}
                />
              )}
            </div>
          </div>
        )}

        <button
          ref={launcherRef}
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="group flex items-center gap-2.5 rounded-full bg-brand-900 py-2 pl-2 pr-4 text-white shadow-xl ring-1 ring-white/10 transition hover:bg-brand-950 focus-visible:outline focus-visible:outline-4 focus-visible:outline-brand-600/40"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400/15">
            {open ? <X className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-sm font-semibold">Escrow Protected</span>
            <span className="block text-[11px] text-brand-200">Help, chat & disputes</span>
          </span>
        </button>
      </div>

      {faqOpen && <FaqModal onClose={() => setFaqOpen(false)} />}
    </>
  );
}
