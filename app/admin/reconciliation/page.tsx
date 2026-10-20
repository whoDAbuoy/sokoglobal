import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, Inbox, Scale, ShieldCheck } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { formatUSD } from '@/lib/format';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { RequeueEvent, ResolveIssue, RunButtons } from '@/components/admin/recon/ReconButtons';

export const metadata = { title: 'Reconciliation · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * Escrow reconciliation + webhook dead-letter queue. Admin only (404 otherwise);
 * tables are admin-readable under RLS, and every action re-checks the role.
 */
export default async function ReconciliationPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/reconciliation');
  if (profile?.role !== 'admin') notFound();

  const [runsRes, issuesRes, deadRes, pendingRes] = await Promise.all([
    supabase.from('escrow_recon_runs').select('id, started_at, finished_at, status, summary, triggered_by').order('started_at', { ascending: false }).limit(10),
    supabase.from('escrow_recon_issues').select('id, severity, kind, provider, reference, order_id, message, expected, actual, created_at')
      .is('resolved_at', null).order('severity', { ascending: true }).order('created_at', { ascending: false }).limit(100),
    supabase.from('payment_events').select('id, provider, event_type, tx_ref, attempts, last_error, received_at, dead_lettered_at')
      .not('dead_lettered_at', 'is', null).is('processed_at', null).order('dead_lettered_at', { ascending: false }).limit(50),
    supabase.from('payment_events').select('id', { count: 'exact', head: true }).is('processed_at', null).is('dead_lettered_at', null),
  ]);
  const missing = [runsRes, issuesRes].some((r) => r.error && /does not exist|schema cache/i.test(r.error.message));

  const runs = runsRes.data ?? [];
  const issues = issuesRes.data ?? [];
  const dead = deadRes.data ?? [];
  const latest = runs[0];
  const s = (latest?.summary ?? {}) as Record<string, number | boolean | Record<string, number>>;
  const critical = issues.filter((i) => i.severity === 'critical').length;

  const tiles = [
    { label: 'Held in escrow (window)', value: typeof s.held_in_escrow_cents === 'number' ? formatUSD(s.held_in_escrow_cents) : '—', icon: ShieldCheck, tone: 'tone-escrow' },
    { label: 'Open critical issues', value: String(critical), icon: AlertOctagon, tone: critical ? 'tone-danger' : 'tone-muted' },
    { label: 'Open warnings', value: String(issues.length - critical), icon: AlertTriangle, tone: issues.length - critical ? 'tone-pending' : 'tone-muted' },
    { label: 'Webhooks waiting / dead', value: `${pendingRes.count ?? 0} / ${dead.length}`, icon: Inbox, tone: dead.length ? 'tone-danger' : 'tone-active' },
  ];

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Internal · Finance</p>
            <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Reconciliation</h1>
            <p className="mt-1 text-sm text-neutral-500">Daily check of local escrow against Paystack and M-Pesa, plus webhook deliveries that failed to process.</p>
          </div>
          <RunButtons />
        </div>

        {missing && (
          <p role="alert" className="tone-pending mt-6 rounded-lg border px-4 py-3 text-sm">
            Run <code className="font-mono">supabase/migrations/013_payment_resilience.sql</code> in the Supabase SQL editor to enable reconciliation.
          </p>
        )}

        <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="card card-lift flex items-center gap-4 p-5">
              <span className={clsx('grid h-10 w-10 place-items-center rounded-lg border', tone)}><Icon className="h-5 w-5" aria-hidden /></span>
              <div>
                <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</dd>
                <dt className="text-sm text-neutral-500">{label}</dt>
              </div>
            </div>
          ))}
        </dl>

        <section aria-labelledby="issues" className="card mt-6 overflow-hidden">
          <h2 id="issues" className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 font-semibold text-neutral-900"><Scale className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden /> Open discrepancies</h2>
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Nothing open — escrow matches the gateways.</p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 max-w-3xl">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={clsx('pill', i.severity === 'critical' ? 'tone-danger' : 'tone-pending')}>{i.severity}</span>
                      <span className="font-medium text-neutral-900">{i.kind.replace(/_/g, ' ')}</span>
                      {i.provider && <span className="pill tone-muted">{i.provider}</span>}
                    </p>
                    <p className="mt-1 text-neutral-700">{i.message}</p>
                    <p className="mt-0.5 font-mono text-xs text-neutral-500">
                      {i.reference && <>ref {i.reference} </>}{i.order_id && <>· order #{String(i.order_id).slice(0, 8).toUpperCase()} </>}
                      {i.expected && <>· expected {JSON.stringify(i.expected)} </>}{i.actual && <>· actual {JSON.stringify(i.actual)}</>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs text-neutral-500">
                    <span>{dt(i.created_at)}</span>
                    <ResolveIssue issueId={i.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="dlq" className="card overflow-hidden">
            <h2 id="dlq" className="border-b border-neutral-200 px-4 py-3 font-semibold text-neutral-900">Dead-lettered webhooks</h2>
            {dead.length === 0 ? <p className="px-4 py-6 text-sm text-neutral-500">None. Failed deliveries are retried automatically with backoff.</p> : (
              <ul className="divide-y divide-neutral-200">
                {dead.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-900">{e.provider} · {e.event_type}</p>
                      <p className="truncate font-mono text-xs text-neutral-500">{e.tx_ref ?? `#${e.id}`} · {e.attempts} attempts · received {dt(e.received_at)}</p>
                      {e.last_error && <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-400">{e.last_error}</p>}
                    </div>
                    <RequeueEvent eventId={e.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="runs" className="card overflow-hidden">
            <h2 id="runs" className="border-b border-neutral-200 px-4 py-3 font-semibold text-neutral-900">Recent runs</h2>
            {runs.length === 0 ? <p className="px-4 py-6 text-sm text-neutral-500">No runs yet. The cron runs daily; use “Run reconciliation” to start one now.</p> : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs text-neutral-500"><tr>
                  <th scope="col" className="px-4 py-2 font-medium">Started</th><th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Checked</th><th scope="col" className="px-4 py-2 font-medium">By</th>
                </tr></thead>
                <tbody className="divide-y divide-neutral-200">
                  {runs.map((r) => {
                    const sum = (r.summary ?? {}) as Record<string, number>;
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2 text-xs text-neutral-700">{dt(r.started_at)}</td>
                        <td className="px-4 py-2"><span className={clsx('pill', r.status === 'ok' ? 'tone-escrow' : r.status === 'issues' ? 'tone-pending' : r.status === 'failed' ? 'tone-danger' : 'tone-muted')}>{r.status}</span></td>
                        <td className="px-4 py-2 text-xs tabular-nums text-neutral-600">{sum.card_payments_checked ?? 0} card · {sum.mpesa_payments_checked ?? 0} M-Pesa · {sum.orders_checked ?? 0} orders</td>
                        <td className="px-4 py-2 text-xs text-neutral-500">{String(r.triggered_by).startsWith('admin:') ? 'Admin' : 'Cron'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
