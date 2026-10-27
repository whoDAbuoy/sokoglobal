'use client';

import {
  useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Loader2, MessageCircle,
  Send, ShieldAlert, ShieldCheck, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { formatUSD } from '@/lib/format';
import type { OrderView } from '@/lib/types';

/**
 * The Trade Support widget's panels (help, FAQ, chat, dispute). Loaded on demand by
 * components/dashboard/SupportWidget.tsx the first time someone opens the widget, so pages
 * that show only the launcher don't ship this code.
 */

/* -------------------------------------------------------------------------- */
/* Content — policy wording must be confirmed by Ops/Legal before launch.      */
/* -------------------------------------------------------------------------- */
const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: 'How does escrow protect my Trial Batch?',
    a: <>Your payment goes to a licensed escrow account, <strong>not to the supplier</strong>. It stays there while the goods are
      made, flown and cleared. The supplier is paid only after <em>you</em> confirm the goods are right at your door. If they aren&apos;t,
      open a dispute and the funds stay frozen until it&apos;s resolved — including a full refund where the supplier is at fault.</>,
  },
  {
    q: 'What does the Guaranteed Landed Cost include?',
    a: <>One fixed price: the product, consolidated air freight and customs clearance and duties to your city. There are no extra
      fees at the airport or on delivery. If customs charges more than we quoted, SokoGlobal covers the difference.</>,
  },
  {
    q: 'What delivery timeline is guaranteed?',
    a: <>Each listing shows the supplier&apos;s lead time. On top of that, allow 5–9 days for consolidated air freight and 1–3 days
      for customs. If your order hasn&apos;t arrived within <strong>lead time + 21 days</strong>, you can open a
      &ldquo;Goods not received&rdquo; dispute for a full refund.</>,
  },
  {
    q: 'When is the supplier paid?',
    a: <>Only after you click <strong>&ldquo;Goods verified — release payment&rdquo;</strong> on the order page. Until then the supplier
      can see that the money is secured, but can&apos;t touch it.</>,
  },
  {
    q: 'What if a Trend Pool doesn’t fill?',
    a: <>If a pool hasn&apos;t raised its full target by the deadline, it closes and every paid pledge is <strong>refunded
      automatically</strong> to the original payment method. You don&apos;t need to do anything.</>,
  },
  {
    q: 'Goods arrived damaged or wrong — what now?',
    a: <>Don&apos;t confirm delivery. Use the <strong>Dispute</strong> tab here: pick the order, describe the issue and attach photos in the
      chat. Funds freeze straight away, and a trade advisor replies within one business day.</>,
  },
];

const DISPUTE_REASONS = [
  ['not_received', 'Goods not received'],
  ['not_as_described', 'Not as described'],
  ['damaged', 'Damaged in transit'],
  ['wrong_quantity', 'Wrong quantity / sizes / shades'],
  ['counterfeit', 'Suspected counterfeit'],
  ['other', 'Other'],
] as const;

interface Message { id: number; body: string; sender_role: 'customer' | 'agent'; created_at: string }
interface Ticket { id: string; status: 'open' | 'awaiting_customer' | 'resolved' }

/* -------------------------------------------------------------------------- */
/* Focus helpers                                                               */
/* -------------------------------------------------------------------------- */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* -------------------------------------------------------------------------- */
/* Help tab                                                                    */
/* -------------------------------------------------------------------------- */
export function HelpPanel({ onOpenFaq, onChat, onDispute }: { onOpenFaq: () => void; onChat: () => void; onDispute?: () => void }) {
  return (
    <div className="space-y-3 overflow-y-auto p-4">
      <button type="button" onClick={onOpenFaq} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/40">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
        <span>
          <span className="block text-sm font-semibold text-slate-900">How escrow protects you</span>
          <span className="block text-xs text-slate-500">Trial Batches, landed cost, delivery timelines, refunds</span>
        </span>
      </button>
      <button type="button" onClick={onChat} className="flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/40">
        <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
        <span>
          <span className="block text-sm font-semibold text-slate-900">Chat with a trade advisor</span>
          <span className="block text-xs text-slate-500">About a specific order or a general question</span>
        </span>
      </button>
      {onDispute && (
        <button type="button" onClick={onDispute} className="flex w-full items-start gap-3 rounded-xl border border-red-200 bg-red-50/40 p-3 text-left hover:bg-red-50">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-slate-900">Report a problem with an order</span>
            <span className="block text-xs text-slate-500">Freezes escrow funds immediately</span>
          </span>
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ modal — focus-trapped, Esc to close, restores focus                     */
/* -------------------------------------------------------------------------- */
export function FaqModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);
  const id = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; restoreTo.current?.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-midnight/50 p-4 backdrop-blur-md sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } trapTab(e, ref.current); }}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">How SokoGlobal protects you</h2>
            <p className="mt-0.5 text-sm text-slate-500">Escrow, landed cost and delivery guarantees</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <ul className="divide-y divide-slate-100 overflow-y-auto px-6">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = expanded === i;
            return (
              <li key={item.q}>
                <h3>
                  <button type="button" aria-expanded={isOpen} aria-controls={`${id}-a${i}`} id={`${id}-q${i}`}
                    onClick={() => setExpanded(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-slate-900">
                    {item.q}
                    <ChevronDown className={clsx('h-4 w-4 shrink-0 text-slate-400 transition', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                </h3>
                <div id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} hidden={!isOpen}
                  className="pb-4 text-sm leading-relaxed text-slate-600">
                  {item.a}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="btn-primary w-full">Got it</button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chat tab — Supabase-backed tickets with Realtime replies                    */
/* -------------------------------------------------------------------------- */
export function ChatPanel({ orders, orderId, onOrderChange, announce }: {
  orders: OrderView[]; orderId: string; onOrderChange: (id: string) => void; announce: (s: string) => void;
}) {
  const supabase = createClient();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const selectId = useId();

  const append = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  // Load the latest unresolved ticket for this order (or general)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setTicket(null); setMessages([]);
      let q = supabase.from('support_tickets').select('id, status').eq('user_id', user.id).neq('status', 'resolved');
      q = orderId ? q.eq('order_id', orderId) : q.is('order_id', null);
      const { data: t } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle<Ticket>();
      if (cancelled) return;
      setTicket(t ?? null);
      if (t) {
        const { data: msgs } = await supabase.from('support_messages')
          .select('id, body, sender_role, created_at').eq('ticket_id', t.id).order('id').limit(200);
        if (!cancelled) setMessages((msgs ?? []) as Message[]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, user, orderId]);

  // Realtime: agent replies stream in (RLS restricts events to this user's tickets)
  useEffect(() => {
    if (!ticket) return;
    const channel = supabase
      .channel(`support:${ticket.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `ticket_id=eq.${ticket.id}` },
        (payload) => {
          const m = payload.new as Message;
          append(m);
          if (m.sender_role === 'agent') announce('New reply from your trade advisor');
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, ticket, append, announce]);

  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' }); }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !user || sending) return;
    setSending(true); setError(null);
    try {
      let current = ticket;
      if (!current) {
        const order = orders.find((o) => o.id === orderId);
        const { data, error: tErr } = await supabase.from('support_tickets')
          .insert({ user_id: user.id, order_id: orderId || null, category: orderId ? 'order_inquiry' : 'other',
                    subject: order ? `Order: ${order.product_title}`.slice(0, 140) : 'General question' })
          .select('id, status').single<Ticket>();
        if (tErr || !data) throw new Error('Could not start the conversation');
        current = data;
        setTicket(data);
      }
      const { data: msg, error: mErr } = await supabase.from('support_messages')
        .insert({ ticket_id: current.id, body: body.slice(0, 4000) })
        .select('id, body, sender_role, created_at').single<Message>();
      if (mErr || !msg) throw new Error('Message not sent — please try again');
      append(msg);
      setDraft('');
      announce('Message sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-100 px-4 py-3">
        <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-slate-600">Conversation about</label>
        <select id={selectId} value={orderId} onChange={(e) => onOrderChange(e.target.value)} className="input py-2 text-sm">
          <option value="">General question</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              #{o.id.slice(0, 8).toUpperCase()} · {o.product_title.slice(0, 32)} · {o.escrow_status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <ol ref={listRef} aria-label="Messages" aria-busy={loading} className="min-h-[12rem] flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-4">
        <li className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          Hi! I&apos;m your trade advisor. {orderId ? 'What can I help you with on this order?' : 'Ask me anything about sourcing, shipping, customs or payments.'}
        </li>
        {loading && <li className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Loading messages" /></li>}
        {messages.map((m) => (
          <li key={m.id} className={clsx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
            m.sender_role === 'customer' ? 'ml-auto rounded-br-sm bg-brand-800 text-white' : 'rounded-bl-sm bg-white text-slate-700 ring-1 ring-slate-200')}>
            <span className="sr-only">{m.sender_role === 'customer' ? 'You' : 'Trade advisor'}: </span>
            {m.body}
            <span className={clsx('mt-1 block text-[10px]', m.sender_role === 'customer' ? 'text-brand-200' : 'text-slate-400')}>
              {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </li>
        ))}
        {ticket && messages.length > 0 && messages[messages.length - 1].sender_role === 'customer' && (
          <li className="text-center text-[11px] text-slate-400">An advisor typically replies within 15 minutes during business hours.</li>
        )}
      </ol>

      <form onSubmit={send} className="border-t border-slate-200 p-3">
        {error && <p role="alert" className="mb-2 flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
        <div className="flex gap-2">
          <label htmlFor={`${selectId}-msg`} className="sr-only">Message</label>
          <textarea id={`${selectId}-msg`} rows={1} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e as unknown as FormEvent); } }}
            placeholder="Type your question…" className="input resize-none py-2" />
          <button type="submit" disabled={sending || !draft.trim()} className="btn-primary px-3" aria-label="Send message">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dispute tab                                                                 */
/* -------------------------------------------------------------------------- */
export function DisputePanel({ orders, announce, onOpened }: {
  orders: OrderView[]; announce: (s: string) => void; onOpened: (orderId: string) => void;
}) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const id = useId();
  const order = orders.find((o) => o.id === orderId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!orderId || !reason) return setError('Choose the order and what went wrong.');
    if (details.trim().length < 30) return setError('Please describe the problem (at least 30 characters).');
    if (!ack) return setError('Please confirm you understand how disputes work.');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, details: details.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not open dispute');
      setDone(true);
      announce('Dispute opened. Escrow funds are frozen.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open dispute');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3 p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" aria-hidden />
        <p className="font-semibold text-slate-900">Dispute opened — funds frozen</p>
        <p className="text-sm text-slate-600">
          {order && <>{formatUSD(order.total_cents, true)} stays in escrow. </>}
          A trade advisor will reply within one business day. Add photos or documents in the chat.
        </p>
        <button type="button" onClick={() => onOpened(orderId)} className="btn-primary w-full">Go to case chat</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 overflow-y-auto p-4" noValidate>
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-600/20">
        <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
        Opening a dispute freezes the escrow payment. The supplier won&apos;t be paid until our team resolves the case.
      </p>

      <div>
        <label htmlFor={`${id}-order`} className="label text-xs">Order</label>
        <select id={`${id}-order`} value={orderId} onChange={(e) => setOrderId(e.target.value)} className="input py-2 text-sm">
          {orders.map((o) => (
            <option key={o.id} value={o.id}>#{o.id.slice(0, 8).toUpperCase()} · {o.product_title.slice(0, 30)} · {formatUSD(o.total_cents)}</option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="label text-xs">What went wrong?</legend>
        <div className="grid grid-cols-2 gap-2">
          {DISPUTE_REASONS.map(([value, label]) => (
            <label key={value} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
              reason === value ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-slate-200 text-slate-700 hover:border-slate-300')}>
              <input type="radio" name={`${id}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)}
                className="h-3.5 w-3.5 text-brand-700 focus:ring-brand-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-details`} className="label text-xs">Details</label>
        <textarea id={`${id}-details`} rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)}
          aria-describedby={`${id}-count`} className="input text-sm"
          placeholder="e.g. 12 of 48 units arrived with broken seals; carton 3 was crushed." />
        <p id={`${id}-count`} className={clsx('mt-1 text-right text-[11px]', details.trim().length < 30 ? 'text-slate-400' : 'text-emerald-700')}>
          {details.trim().length}/2000 · min 30
        </p>
      </div>

      <label className="flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600" />
        I understand funds stay frozen until SokoGlobal resolves this dispute, and I may be asked for photos.
      </label>

      {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}

      <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Open dispute & freeze funds
      </button>
    </form>
  );
}

