import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Inbox, MessageSquareReply, Package, Search, ShieldAlert,
} from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import {
  inboxCounts, inMailbox, initials, LABELS, MAILBOXES, parseLabel, parseMailbox, relativeTime, snippet,
  sortTickets, splitHistory, statusDot, type MailboxId, type TicketCategory, type TicketStatus,
} from '@/lib/admin-inbox';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import InboxRealtime from '@/components/admin/support/InboxRealtime';
import MutedIcon from '@/components/admin/support/MutedIcon';
import ReplyBox from '@/components/admin/support/ReplyBox';
import ThreadHistory from '@/components/admin/support/ThreadHistory';
import { resolveTicket } from './actions';

export const metadata = { title: 'Support inbox · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type Customer = { full_name: string; company_name: string; country_code: string };
interface Ticket {
  id: string; subject: string; category: TicketCategory; status: TicketStatus;
  last_message_at: string; order_id: string | null; customer: Customer | null;
}
interface Message { id: number; ticket_id?: string; body: string; sender_role: 'customer' | 'agent'; created_at: string }

const BOX_ICON: Record<MailboxId, typeof Inbox> = {
  inbox: Inbox, needs_reply: MessageSquareReply, awaiting: Clock, disputes: AlertTriangle, resolved: CheckCircle2,
};
const CATEGORY_LABEL = Object.fromEntries(LABELS.map((l) => [l.id, l.label])) as Record<TicketCategory, string>;
const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Needs reply', awaiting_customer: 'Awaiting customer', resolved: 'Resolved' };

/**
 * Agent workspace for the buyer Support widget: mailboxes + labels, the
 * conversation list and the thread with a reply box. Disputes are pinned to
 * the top. Writes go through the existing replyToTicket / resolveTicket actions.
 */
export default async function SupportInbox({ searchParams }: {
  searchParams: Promise<{ t?: string; box?: string; label?: string; q?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/support');
  if (profile?.role !== 'admin') notFound();

  const box = parseMailbox(params.box);
  const label = parseLabel(params.label);
  const q = (params.q ?? '').trim().slice(0, 100).toLowerCase();

  const select = 'id, subject, category, status, last_message_at, order_id, user:profiles!support_tickets_user_id_fkey ( full_name, company_name, country_code )';
  const [openRes, resolvedRes, resolvedCount] = await Promise.all([
    supabase.from('support_tickets').select(select).neq('status', 'resolved').order('last_message_at', { ascending: false }).limit(200),
    supabase.from('support_tickets').select(select).eq('status', 'resolved').order('last_message_at', { ascending: false }).limit(100),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'resolved'),
  ]);
  if (openRes.error) throw new Error(`Could not load support tickets: ${openRes.error.message}`);

  const toTicket = (r: Record<string, unknown>): Ticket => ({
    id: r.id as string, subject: r.subject as string, category: r.category as TicketCategory, status: r.status as TicketStatus,
    last_message_at: r.last_message_at as string, order_id: (r.order_id as string | null) ?? null,
    customer: one(r.user as Customer | Customer[] | null),
  });
  const tickets = [...(openRes.data ?? []), ...(resolvedRes.data ?? [])].map((r) => toTicket(r as Record<string, unknown>));
  const counts = inboxCounts(tickets);
  counts.boxes.resolved = resolvedCount.count ?? counts.boxes.resolved;

  const visible = sortTickets(tickets.filter((t) =>
    inMailbox(t, box)
    && (!label || t.category === label)
    && (!q || t.subject.toLowerCase().includes(q) || t.customer?.company_name.toLowerCase().includes(q) || t.customer?.full_name.toLowerCase().includes(q))));

  const explicit = params.t && UUID_RE.test(params.t) ? params.t : null;
  const active = tickets.find((t) => t.id === explicit) ?? visible[0] ?? null;

  const [previewRes, messagesRes] = await Promise.all([
    visible.length
      ? supabase.from('support_messages').select('ticket_id, body, sender_role, created_at, id')
        .in('ticket_id', visible.slice(0, 100).map((t) => t.id)).order('id', { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as Message[] }),
    active
      ? supabase.from('support_messages').select('id, body, sender_role, created_at').eq('ticket_id', active.id).order('id')
      : Promise.resolve({ data: [] as Message[] }),
  ]);
  const preview = new Map<string, Message>();
  for (const m of (previewRes.data ?? []) as Message[]) if (m.ticket_id && !preview.has(m.ticket_id)) preview.set(m.ticket_id, m);
  const messages = (messagesRes.data ?? []) as Message[];
  const { earlier, recent } = splitHistory(messages, 3);

  const link = (over: { box?: MailboxId; label?: TicketCategory | null; t?: string | null; q?: string }) => {
    const sp = new URLSearchParams();
    const b = over.box ?? box;
    const l = over.label === undefined ? label : over.label;
    const query = over.q ?? q;
    if (b !== 'inbox') sp.set('box', b);
    if (l) sp.set('label', l);
    if (query) sp.set('q', query);
    if (over.t) sp.set('t', over.t);
    const s = sp.toString();
    return `/admin/support${s ? `?${s}` : ''}`;
  };

  const customerName = active?.customer?.full_name ?? active?.customer?.company_name ?? 'customer';
  const subjects = Object.fromEntries(tickets.map((t) => [t.id, t.subject]));

  const navItem = (activeItem: boolean) => clsx(
    'flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors',
    activeItem ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900');

  return (
    <>
      <DashboardHeader profile={profile} />
      <InboxRealtime subjects={subjects} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-xl border border-neutral-200 bg-white lg:h-[calc(100vh-8rem)] lg:min-h-[36rem] lg:grid-cols-[13rem_20rem_minmax(0,1fr)]">

          {/* Column 1: mailboxes + labels (horizontal chips below lg) */}
          <aside className="border-b border-neutral-200 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <p className="hidden px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-neutral-500 lg:block">Mailboxes</p>
            <nav aria-label="Mailboxes" className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {MAILBOXES.map((m) => {
                const Icon = BOX_ICON[m.id];
                const n = counts.boxes[m.id];
                return (
                  <Link key={m.id} href={link({ box: m.id, label: null })} aria-current={box === m.id && !label ? 'page' : undefined} className={navItem(box === m.id && !label)}>
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="flex-1">{m.label}</span>
                    {n > 0 && <span className="text-xs tabular-nums text-neutral-500">{n}</span>}
                  </Link>
                );
              })}
            </nav>
            <div className="my-3 hidden border-t border-neutral-200 lg:block" />
            <p className="hidden px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-neutral-500 lg:block">Labels</p>
            <nav aria-label="Labels" className="no-scrollbar mt-2 flex gap-1 overflow-x-auto lg:mt-0 lg:flex-col lg:overflow-visible">
              {LABELS.map((l) => (
                <Link key={l.id} href={link({ label: label === l.id ? null : l.id })} aria-current={label === l.id ? 'page' : undefined} className={navItem(label === l.id)}>
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', l.dot)} aria-hidden />
                  <span className="flex-1">{l.label}</span>
                  {counts.labels[l.id] > 0 && <span className="text-xs tabular-nums text-neutral-500">{counts.labels[l.id]}</span>}
                </Link>
              ))}
            </nav>
          </aside>

          {/* Column 2: conversation list */}
          <section aria-label="Conversations" className={clsx('flex min-h-0 flex-col border-neutral-200 lg:border-r', explicit ? 'hidden lg:flex' : 'flex')}>
            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <h1 className="font-semibold text-neutral-900">{label ? CATEGORY_LABEL[label] : MAILBOXES.find((m) => m.id === box)!.label}</h1>
              <div className="flex rounded-md border border-neutral-200 p-0.5 text-xs">
                <Link href={link({ box: 'inbox' })} className={clsx('rounded px-2 py-1', box === 'inbox' ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-900')}>All</Link>
                <Link href={link({ box: 'needs_reply' })} className={clsx('rounded px-2 py-1', box === 'needs_reply' ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-900')}>
                  Needs reply ({counts.boxes.needs_reply})
                </Link>
              </div>
            </div>
            <form role="search" action="/admin/support" className="px-4 pb-3">
              {box !== 'inbox' && <input type="hidden" name="box" value={box} />}
              {label && <input type="hidden" name="label" value={label} />}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                <input name="q" defaultValue={params.q ?? ''} placeholder="Search subject or customer" aria-label="Search conversations" className="input py-2 pl-9" />
              </div>
            </form>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3 lg:max-h-none">
              {visible.length === 0 && <li className="px-3 py-8 text-center text-sm text-neutral-500">{q ? 'No conversations match.' : 'Nothing here — inbox zero.'}</li>}
              {visible.map((tk) => {
                const dot = statusDot(tk);
                const last = preview.get(tk.id);
                const current = tk.id === active?.id;
                return (
                  <li key={tk.id}>
                    <Link href={link({ t: tk.id })} aria-current={current ? 'true' : undefined}
                      className={clsx('flex gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                        current ? 'border-neutral-300 bg-neutral-100' : 'border-transparent hover:bg-neutral-50')}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-700">
                        {initials(tk.customer?.full_name ?? tk.customer?.company_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-neutral-900">{tk.customer?.full_name ?? tk.customer?.company_name ?? 'Customer'}</span>
                          <span className="shrink-0 text-[11px] text-neutral-500">{relativeTime(tk.last_message_at)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-800">
                          {tk.category === 'dispute' && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-600" aria-label="Dispute" />}
                          <span className="truncate">{tk.subject}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="flex-1 truncate text-xs text-neutral-500">
                            {last ? `${last.sender_role === 'agent' ? 'You: ' : ''}${snippet(last.body, 70)}` : tk.customer?.company_name}
                          </span>
                          <MutedIcon ticketId={tk.id} />
                          <span className={clsx('h-2 w-2 shrink-0 rounded-full', dot.className)} title={dot.label} aria-label={dot.label} />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Column 3: thread */}
          <section aria-label="Conversation" className={clsx('min-h-[28rem] min-w-0 flex-col', explicit ? 'flex' : 'hidden lg:flex')}>
            {active ? (
              <>
                <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
                  <Link href={link({ t: null })} className="mr-1 rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 lg:hidden" aria-label="Back to conversations">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                  </Link>
                  <span className="pill">
                    <span className={clsx('h-1.5 w-1.5 rounded-full', LABELS.find((l) => l.id === active.category)?.dot)} aria-hidden />
                    {CATEGORY_LABEL[active.category]}
                  </span>
                  <span className="pill">
                    <span className={clsx('h-1.5 w-1.5 rounded-full', statusDot(active).className)} aria-hidden />
                    {STATUS_LABEL[active.status]}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {active.order_id && (
                      <Link href={`/admin/orders/${active.order_id}/tracking`} className="btn-secondary px-2.5 py-1.5 text-xs">
                        <Package className="h-3.5 w-3.5" aria-hidden /> Order #{active.order_id.slice(0, 8).toUpperCase()}
                      </Link>
                    )}
                    {active.status !== 'resolved' && (
                      <form action={resolveTicket}>
                        <input type="hidden" name="ticketId" value={active.id} />
                        <button className="btn-secondary px-2.5 py-1.5 text-xs"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Mark resolved</button>
                      </form>
                    )}
                  </div>
                </header>
                <div className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-neutral-300 text-sm font-semibold text-neutral-700">{initials(customerName)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold text-neutral-900">{active.subject}</h2>
                      <span className="shrink-0 text-xs text-neutral-500">{relativeTime(active.last_message_at)}</span>
                    </div>
                    <p className="text-sm text-neutral-700">{customerName}</p>
                    <p className="text-xs text-neutral-500">{active.customer?.company_name}{active.customer?.country_code ? ` · ${active.customer.country_code}` : ''}</p>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ThreadHistory count={earlier.length}>
                    {earlier.map((m) => <MessageItem key={m.id} m={m} customerName={customerName} />)}
                  </ThreadHistory>
                  {messages.length === 0 && <p className="px-5 py-8 text-sm text-neutral-500">No messages yet.</p>}
                  {recent.map((m) => <MessageItem key={m.id} m={m} customerName={customerName} />)}
                </div>

                <ReplyBox ticketId={active.id} customerName={customerName} disabled={active.status === 'resolved'} />
              </>
            ) : (
              <div className="m-auto flex flex-col items-center px-6 py-16 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
                <p className="mt-3 font-medium text-neutral-900">No conversation selected</p>
                <p className="mt-1 text-sm text-neutral-500">Pick a thread from the list.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function MessageItem({ m, customerName }: { m: Message; customerName: string }) {
  const agent = m.sender_role === 'agent';
  const name = agent ? 'Trade Support' : customerName;
  return (
    <article className="flex gap-3 px-5 py-4">
      <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
        agent ? 'bg-neutral-900 text-white' : 'border border-neutral-300 text-neutral-700')}>
        {agent ? 'TS' : initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-neutral-900">{name}{agent && <span className="ml-1.5 text-xs font-normal text-neutral-500">(agent)</span>}</p>
          <time dateTime={m.created_at} className="shrink-0 text-xs text-neutral-500">
            {new Date(m.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
          </time>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{m.body}</p>
      </div>
    </article>
  );
}
