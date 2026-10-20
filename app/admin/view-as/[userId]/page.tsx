import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, Eye, Lock, MessageSquare, Package, Snowflake, Store, Wallet } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdmin, requestFingerprint } from '@/lib/auth/admin-access';
import { statusMeta, type Tone } from '@/lib/order-status';
import { ROLE_LABEL } from '@/lib/user-admin';
import { countryName, flag, formatUSD } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import type { EscrowStatus, UserRole } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';

export const metadata = { title: 'View as · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Record<Tone, string> = { warning: 'tone-pending', escrow: 'tone-escrow', success: 'tone-active', danger: 'tone-danger', muted: 'tone-muted' };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * Read-only inspector: what one account sees in its portal (orders, listings,
 * payouts, conversations), for support and dispute work. Super admins only.
 *
 * Nothing here can act as the user: there are no forms, the page never
 * borrows their session, and the service-role reads run only after the super
 * admin check. Every visit is written to admin_audit_logs with the caller's IP.
 */
export default async function ViewAsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect(`/login?redirectTo=/admin/view-as/${userId}`);
  if (!isSuperAdmin(profile) || !UUID_RE.test(userId)) notFound();

  const db = createAdminClient();
  const { data: target } = await db.from('profiles')
    .select('id, role, full_name, company_name, country_code, kyc_verified, is_banned, ban_reason, is_frozen, freeze_reason, created_at')
    .eq('id', userId).maybeSingle<{
      id: string; role: UserRole; full_name: string; company_name: string; country_code: string; kyc_verified: boolean;
      is_banned: boolean; ban_reason: string | null; is_frozen: boolean; freeze_reason: string | null; created_at: string;
    }>();
  if (!target) notFound();

  // Audit first: if logging fails the page does not render.
  const fp = requestFingerprint(await headers());
  const { error: auditError } = await supabase.rpc('log_admin_action', {
    p_action: 'user.view_as', p_target_type: 'user', p_target_id: userId, p_detail: { role: target.role }, p_ip: fp.ip, p_ua: fp.ua,
  });
  if (auditError) throw new Error(`View-As needs migration 014 (audit log): ${auditError.message}`);

  const isSupplier = target.role === 'supplier';
  const [{ data: authUser }, ordersRes, productsRes, payoutsRes, threadsRes, ticketsRes] = await Promise.all([
    db.auth.admin.getUserById(userId),
    isSupplier
      ? db.from('orders').select('id, escrow_status, total_cents, created_at, product:products!inner ( title, supplier_id )').eq('product.supplier_id', userId).order('created_at', { ascending: false }).limit(15)
      : db.from('orders').select('id, escrow_status, total_cents, created_at, product:products ( title )').eq('buyer_id', userId).order('created_at', { ascending: false }).limit(15),
    isSupplier
      ? db.from('products').select('id, title, status, trial_landed_cost_cents, created_at').eq('supplier_id', userId).order('created_at', { ascending: false }).limit(15)
      : Promise.resolve({ data: [] as { id: string; title: string; status: string; trial_landed_cost_cents: number; created_at: string }[] }),
    isSupplier
      ? db.from('payouts').select('id, status, amount_cents, currency, created_at').eq('supplier_id', userId).order('created_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { id: string; status: string; amount_cents: number; currency: string; created_at: string }[] }),
    db.from('chat_threads').select('id', { count: 'exact', head: true }).or(`buyer_id.eq.${userId},supplier_id.eq.${userId}`),
    db.from('support_tickets').select('id, subject, status, last_message_at').eq('user_id', userId).order('last_message_at', { ascending: false }).limit(5),
  ]);

  const orders = (ordersRes.data ?? []).map((o) => ({ ...o, title: one(o.product as unknown as { title: string })?.title ?? 'Order' }));

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Users</Link>

        <div role="note" className="mt-4 flex items-start gap-2.5 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-100">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p><strong>Read-only view</strong> of {target.full_name}&apos;s portal. Nothing on this page can act as them; this visit is recorded in the audit log.</p>
        </div>

        <section className="card mt-6 flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="eyebrow">{ROLE_LABEL[target.role] ?? target.role}</p>
            <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{target.company_name}</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {target.full_name} · {authUser?.user?.email ?? 'no email'} · {flag(target.country_code)} {countryName(target.country_code)}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Joined {date(target.created_at)} · Last sign-in {date(authUser?.user?.last_sign_in_at)} · {target.kyc_verified ? 'KYC verified' : 'KYC not verified'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {target.is_banned && <span className="pill tone-danger" title={target.ban_reason ?? undefined}>Banned</span>}
            {target.is_frozen && <span className="pill tone-transit" title={target.freeze_reason ?? undefined}><Snowflake className="h-3 w-3" aria-hidden /> Frozen</span>}
            <span className="pill tone-muted"><MessageSquare className="h-3 w-3" aria-hidden /> {threadsRes.count ?? 0} conversations</span>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel icon={Package} title={isSupplier ? 'Orders for their products' : 'Their orders'}>
            {orders.length === 0 ? <Empty /> : orders.map((o) => {
              const m = statusMeta(o.escrow_status as EscrowStatus);
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-neutral-900">{o.title}</p>
                    <p className="text-xs text-neutral-500">#{o.id.slice(0, 8).toUpperCase()} · {date(o.created_at)} · {formatUSD(o.total_cents)}</p>
                  </div>
                  <Link href={`/admin/control?order=${o.id}`} className={clsx('pill shrink-0', TONE[m.tone])}>{m.label}</Link>
                </li>
              );
            })}
          </Panel>

          {isSupplier ? (
            <Panel icon={Store} title="Their listings">
              {(productsRes.data ?? []).length === 0 ? <Empty /> : (productsRes.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-neutral-900">{p.title}</p>
                    <p className="text-xs text-neutral-500">Listed {date(p.created_at)} · Landed {formatUSD(p.trial_landed_cost_cents)}</p>
                  </div>
                  <span className="pill tone-muted shrink-0 capitalize">{p.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </Panel>
          ) : (
            <Panel icon={Lock} title="Support tickets">
              {(ticketsRes.data ?? []).length === 0 ? <Empty /> : (ticketsRes.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <p className="truncate font-medium text-neutral-900">{t.subject}</p>
                  <span className="pill tone-muted shrink-0 capitalize">{String(t.status).replace(/_/g, ' ')}</span>
                </li>
              ))}
            </Panel>
          )}

          {isSupplier && (
            <Panel icon={Wallet} title="Payouts">
              {(payoutsRes.data ?? []).length === 0 ? <Empty /> : (payoutsRes.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <p className="text-neutral-900">{formatUSD(p.amount_cents)} <span className="text-xs text-neutral-500">· {date(p.created_at)}</span></p>
                  <span className="pill tone-muted shrink-0 capitalize">{String(p.status).replace(/_/g, ' ')}</span>
                </li>
              ))}
            </Panel>
          )}
        </div>
      </main>
    </>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Package; title: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-900">
        <Icon className="h-4 w-4 text-neutral-500" aria-hidden /> {title}
      </h2>
      <ul className="divide-y divide-neutral-200">{children}</ul>
    </section>
  );
}

const Empty = () => <li className="px-4 py-8 text-center text-sm text-neutral-500">Nothing yet.</li>;
