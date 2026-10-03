import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { CheckCircle2, Send, ShieldAlert } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { replyToTicket, resolveTicket } from './actions';

export const metadata = { title: 'Support inbox · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Agent inbox for the buyer Support widget. Disputes are pinned to the top. */
export default async function SupportInbox({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/support');
  if (profile?.role !== 'admin') notFound();

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('id, subject, category, status, last_message_at, order_id, user:profiles!support_tickets_user_id_fkey ( company_name, country_code )')
    .neq('status', 'resolved')
    .order('last_message_at', { ascending: false })
    .limit(100);

  const sorted = [...(tickets ?? [])].sort((a, b) => Number(b.category === 'dispute') - Number(a.category === 'dispute'));
  const activeId = t && UUID_RE.test(t) ? t : sorted[0]?.id;
  const active = sorted.find((x) => x.id === activeId);
  const { data: messages } = activeId
    ? await supabase.from('support_messages').select('id, body, sender_role, created_at').eq('ticket_id', activeId).order('id')
    : { data: [] };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[22rem_1fr] lg:px-8">
        <aside className="card h-fit overflow-hidden">
          <h1 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Open conversations ({sorted.length})</h1>
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {sorted.length === 0 && <li className="px-4 py-6 text-sm text-slate-500">Inbox zero.</li>}
            {sorted.map((tk) => {
              const u = one(tk.user as unknown as { company_name: string; country_code: string });
              return (
                <li key={tk.id}>
                  <Link href={`/admin/support?t=${tk.id}`} aria-current={tk.id === activeId ? 'page' : undefined}
                    className={clsx('block px-4 py-3 text-sm hover:bg-slate-50', tk.id === activeId && 'bg-brand-50/60')}>
                    <span className="flex items-center gap-1.5 font-medium text-slate-900">
                      {tk.category === 'dispute' && <ShieldAlert className="h-3.5 w-3.5 text-red-600" aria-label="Dispute" />}
                      <span className="truncate">{tk.subject}</span>
                    </span>
                    <span className="mt-0.5 flex justify-between text-xs text-slate-500">
                      <span>{u?.company_name}</span>
                      <span className={tk.status === 'open' ? 'font-medium text-amber-700' : ''}>{tk.status === 'open' ? 'Needs reply' : 'Waiting on customer'}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="card flex min-h-[28rem] flex-col overflow-hidden">
          {active ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{active.subject}</h2>
                  {active.order_id && <p className="text-xs text-slate-500">Order #{active.order_id.slice(0, 8).toUpperCase()}</p>}
                </div>
                <form action={resolveTicket}>
                  <input type="hidden" name="ticketId" value={active.id} />
                  <button className="btn-secondary py-1.5 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved</button>
                </form>
              </header>
              <ol className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-5">
                {(messages ?? []).map((m) => (
                  <li key={m.id} className={clsx('max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
                    m.sender_role === 'agent' ? 'ml-auto rounded-br-sm bg-brand-800 text-white' : 'rounded-bl-sm bg-white text-slate-700 ring-1 ring-slate-200')}>
                    {m.body}
                    <span className={clsx('mt-1 block text-[10px]', m.sender_role === 'agent' ? 'text-brand-200' : 'text-slate-400')}>
                      {new Date(m.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </li>
                ))}
              </ol>
              <form action={replyToTicket} className="flex gap-2 border-t border-slate-200 p-3">
                <input type="hidden" name="ticketId" value={active.id} />
                <label htmlFor="reply" className="sr-only">Reply</label>
                <textarea id="reply" name="body" rows={2} required maxLength={4000} className="input" placeholder="Reply as Trade Support…" />
                <button className="btn-primary self-end"><Send className="h-4 w-4" /> Send</button>
              </form>
            </>
          ) : (
            <p className="m-auto text-sm text-slate-500">Select a conversation.</p>
          )}
        </section>
      </main>
    </>
  );
}
