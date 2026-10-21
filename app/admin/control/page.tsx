import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { Gauge, History, Search, ShieldAlert } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { isAdmin, isPermanentAdmin, isSuperAdmin } from '@/lib/auth/admin-access';
import { getPlatformSettings } from '@/lib/platform-server';
import { statusMeta, type Tone } from '@/lib/order-status';
import { formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import type { EscrowStatus } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import PlatformSwitches from '@/components/admin/control/PlatformSwitches';
import OrderOverrides from '@/components/admin/control/OrderOverrides';
import { financialOverrideBlock } from '@/lib/security/two-factor-gate';
import { twoFactorState } from '@/lib/security/two-factor-server';

export const metadata = { title: 'Control room · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Record<Tone, string> = { warning: 'tone-pending', escrow: 'tone-escrow', success: 'tone-active', danger: 'tone-danger', muted: 'tone-muted' };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const AUDIT_FILTERS = [['', 'Everything'], ['escrow.', 'Escrow & refunds'], ['payout.', 'Payouts'], ['order.', 'Orders'], ['product.', 'Catalogue'], ['admin.', 'Admin grants'], ['account.', 'Freezes'], ['user.', 'User moderation'], ['platform.', 'Platform switches'], ['category.', 'Categories']] as const;

interface AuditRow { id: number; actor_id: string | null; actor_level: string | null; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; ip: string | null; created_at: string }

/**
 * Control room: the global kill switch (permanent admins), super admin order /
 * escrow overrides, and the immutable audit trail (all admins can read it).
 */
export default async function ControlPage({ searchParams }: { searchParams: Promise<{ order?: string; audit?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/control');
  if (!isAdmin(profile)) notFound();
  const sp = await searchParams;
  const orderId = sp.order?.trim().toLowerCase() ?? '';
  const auditFilter = AUDIT_FILTERS.some(([v]) => v === sp.audit) ? sp.audit ?? '' : '';
  const superAdmin = isSuperAdmin(profile);
  const moneyBlocked = superAdmin ? financialOverrideBlock(await twoFactorState(supabase)) : null;

  let auditQ = supabase.from('admin_audit_logs').select('id, actor_id, actor_level, action, target_type, target_id, detail, ip, created_at')
    .order('created_at', { ascending: false }).limit(60);
  if (auditFilter) auditQ = auditQ.like('action', `${auditFilter}%`);
  if (UUID_RE.test(orderId)) auditQ = auditQ.eq('target_id', orderId);

  const [settings, auditRes, orderRes] = await Promise.all([
    getPlatformSettings(supabase),
    auditQ,
    superAdmin && UUID_RE.test(orderId)
      ? supabase.from('orders').select(`id, escrow_status, total_cents, goods_cents, freight_cents, customs_cents, checkout_group_id, tracking_number, carrier, created_at,
          product:products ( title ), buyer:profiles!orders_buyer_id_fkey ( company_name ), payout:payouts ( status )`).eq('id', orderId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const migrationMissing = !!auditRes.error;
  const audit = (auditRes.data ?? []) as AuditRow[];

  const actorIds = [...new Set(audit.map((a) => a.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  const o = orderRes.data as (null | {
    id: string; escrow_status: EscrowStatus; total_cents: number; goods_cents: number; freight_cents: number; customs_cents: number;
    checkout_group_id: string | null; tracking_number: string | null; carrier: string | null; created_at: string;
    product: unknown; buyer: unknown; payout: unknown;
  });
  const { data: overrides } = o
    ? await supabase.from('financial_overrides').select('id, action, amount_cents, provider, provider_ref, status, reason, created_at').eq('order_id', o.id).order('created_at', { ascending: false }).limit(10)
    : { data: [] };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow">Internal · {superAdmin ? 'Super admin' : 'Admin'}</p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-neutral-900"><Gauge className="h-7 w-7 text-neutral-500" aria-hidden /> Control room</h1>
        <p className="mt-1 text-sm text-neutral-600">Platform switches, escrow and order overrides, and the audit trail. Every change here is recorded with who, when and from which IP.</p>

        {migrationMissing && (
          <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Run <code className="font-mono">supabase/migrations/014_super_admin.sql</code> to enable the control room.
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section aria-labelledby="switches" className="card p-5">
            <h2 id="switches" className="flex items-center gap-2 font-semibold text-neutral-900"><ShieldAlert className="h-4 w-4 text-rose-600" aria-hidden /> Global kill switch</h2>
            <PlatformSwitches settings={settings} canEdit={isPermanentAdmin(profile) && !migrationMissing} />
          </section>

          <section aria-labelledby="overrides" className="card p-5">
            <h2 id="overrides" className="font-semibold text-neutral-900">Order &amp; escrow overrides</h2>
            {!superAdmin ? (
              <p className="mt-2 text-sm text-neutral-600">Only super admins can force-release escrow, refund, start payouts or edit landed cost.</p>
            ) : (
              <>
                {moneyBlocked && (
                  <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                    {moneyBlocked}{' '}
                    <Link href="/dashboard/settings?tab=security" className="font-medium underline underline-offset-4">Open security settings</Link>
                    <span className="block text-xs">Tracking numbers still work; force release, refunds, payouts and landed cost need it.</span>
                  </p>
                )}
                <form className="mt-3 flex gap-2" action="/admin/control">
                  <label htmlFor="order-id" className="sr-only">Order ID</label>
                  <input id="order-id" name="order" defaultValue={orderId} placeholder="Order ID (UUID)" className="input font-mono text-xs" autoComplete="off" />
                  <button className="btn-secondary px-3"><Search className="h-4 w-4" aria-hidden /> Find</button>
                </form>
                {orderId && !o && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">No order with that ID.</p>}
                {o && (() => {
                  const m = statusMeta(o.escrow_status);
                  return (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-neutral-100 p-3.5 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-neutral-900">{one(o.product as { title: string } | null)?.title ?? 'Order'}</p>
                          <p className="text-xs text-neutral-600">
                            #{o.id.slice(0, 8).toUpperCase()} · {one(o.buyer as { company_name: string } | null)?.company_name ?? 'Buyer'} · goods {formatUSD(o.goods_cents, true)} + freight {formatUSD(o.freight_cents, true)} + customs {formatUSD(o.customs_cents, true)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={clsx('pill', TONE[m.tone])}>{m.label}</span>
                          <p className="mt-1 text-sm font-semibold tabular-nums text-neutral-900">{formatUSD(o.total_cents, true)}</p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <OrderOverrides order={{
                          id: o.id, escrow_status: o.escrow_status, total_cents: o.total_cents, goods_cents: o.goods_cents, freight_cents: o.freight_cents,
                          customs_cents: o.customs_cents, checkout_group_id: o.checkout_group_id, tracking_number: o.tracking_number, carrier: o.carrier,
                          has_payout: !!one(o.payout as { status: string } | null),
                        }} />
                      </div>
                      {(overrides ?? []).length > 0 && (
                        <ul className="mt-5 space-y-1.5 border-t border-neutral-200 pt-3 text-xs text-neutral-700">
                          {(overrides ?? []).map((f) => (
                            <li key={f.id}><strong className="font-medium">{f.action.replace(/_/g, ' ')}</strong>{f.amount_cents ? ` · ${formatUSD(f.amount_cents, true)}` : ''} · {f.status.replace(/_/g, ' ')}{f.provider_ref ? ` · ${f.provider_ref}` : ''} — {f.reason} <span className="text-neutral-500">({new Date(f.created_at).toLocaleString('en-GB')})</span></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </section>
        </div>

        <section aria-labelledby="audit" className="card mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
            <h2 id="audit" className="flex items-center gap-2 font-semibold text-neutral-900"><History className="h-4 w-4 text-neutral-500" aria-hidden /> Audit log <span className="text-xs font-normal text-neutral-500">append-only · latest 60</span></h2>
            <nav aria-label="Audit filters" className="flex flex-wrap gap-1.5">
              {AUDIT_FILTERS.map(([v, l]) => (
                <Link key={v} href={`/admin/control?${new URLSearchParams({ ...(v ? { audit: v } : {}), ...(orderId ? { order: orderId } : {}) })}`}
                  aria-current={auditFilter === v ? 'true' : undefined}
                  className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium', auditFilter === v ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-900')}>
                  {l}
                </Link>
              ))}
            </nav>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-600">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">When</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Who</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Action</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Target</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Detail</th>
                  <th scope="col" className="px-5 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {audit.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-neutral-500">No audit entries yet.</td></tr>}
                {audit.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-neutral-700">{new Date(a.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })}</td>
                    <td className="px-5 py-3 text-xs text-neutral-800">{a.actor_id ? actorName.get(a.actor_id) ?? a.actor_id.slice(0, 8) : 'System'}<span className="block text-neutral-500">{a.actor_level}</span></td>
                    <td className="px-5 py-3"><code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-900">{a.action}</code></td>
                    <td className="px-5 py-3 text-xs text-neutral-700">
                      {a.target_type === 'order' && a.target_id && superAdmin
                        ? <Link href={`/admin/control?order=${a.target_id}`} className="font-mono text-blue-700 hover:underline dark:text-cyan-300">order {a.target_id.slice(0, 8)}</Link>
                        : a.target_type === 'user' && a.target_id && superAdmin
                          ? <Link href={`/admin/view-as/${a.target_id}`} className="font-mono text-blue-700 hover:underline dark:text-cyan-300">user {a.target_id.slice(0, 8)}</Link>
                          : <span className="font-mono">{a.target_type} {a.target_id?.slice(0, 12)}</span>}
                    </td>
                    <td className="max-w-md px-5 py-3 text-xs text-neutral-700"><span className="line-clamp-2 break-all font-mono">{JSON.stringify(a.detail)}</span></td>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-neutral-600">{a.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
