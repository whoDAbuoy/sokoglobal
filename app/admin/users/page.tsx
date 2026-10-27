import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Snowflake, UserCheck, UserCog, Users, UserX } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { pageList, parsePage } from '@/lib/admin-metrics';
import { initials } from '@/lib/admin-inbox';
import { ROLE_FILTERS, ROLE_LABEL, STATUS_FILTERS, USER_PAGE_SIZE, parseRoleFilter, parseStatusFilter, userStatus } from '@/lib/user-admin';
import { countryName, flag } from '@/lib/format';
import type { UserRole } from '@/lib/types';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import UserActions from '@/components/admin/users/UserActions';
import ChangeRequestCard, { type ChangeRequest } from '@/components/admin/users/ChangeRequestCard';
import { formatTimeLeft, isAdmin, isSuperAdmin } from '@/lib/auth/admin-access';
import SuperUserControls from '@/components/admin/users/SuperUserControls';
import MessageUserButton from '@/components/admin/users/MessageUserButton';

export const metadata = { title: 'Users · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface DirectoryRow {
  id: string; full_name: string; company_name: string; email: string | null; role: UserRole; country_code: string;
  kyc_verified: boolean; is_banned: boolean; ban_reason: string | null; created_at: string; last_sign_in_at: string | null;
  pending_change: boolean; total_count: number;
  /** Migration 014 columns. */
  is_frozen?: boolean; grant_id?: string | null; grant_expires_at?: string | null;
}

/**
 * Admin user management: directory (search, filters, pagination), ban /
 * unban / delete, and the profile change approval queue. Access: admin only
 * (404 otherwise); every read and write is re-checked in SQL.
 */
export default async function AdminUsersPage({ searchParams }: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/users');
  if (!isAdmin(profile)) notFound();

  const viewerIsSuper = isSuperAdmin(profile);
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 100);
  const role = parseRoleFilter(params.role);
  const status = parseStatusFilter(params.status);
  const requested = parsePage(params.page);

  const [listRes, requestsRes, bannedCount, pendingCount, totalCount] = await Promise.all([
    supabase.rpc('admin_list_users', {
      p_query: q || null, p_role: role || null, p_status: status || null,
      p_limit: USER_PAGE_SIZE, p_offset: (requested - 1) * USER_PAGE_SIZE,
    }),
    supabase.from('profile_change_requests')
      .select('id, user_id, created_at, note, current_full_name, current_company_name, full_name, company_name, user:profiles!profile_change_requests_user_id_fkey ( role )')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(30),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_banned', true),
    supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
  ]);

  const migrationMissing = !!listRes.error && /admin_list_users|is_banned|does not exist|schema cache/i.test(listRes.error.message);
  if (listRes.error && !migrationMissing) throw new Error(`Could not load users: ${listRes.error.message}`);

  const rows = (listRes.data ?? []) as DirectoryRow[];
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  const requests: ChangeRequest[] = (requestsRes.data ?? []).map((r) => ({
    id: r.id, user_id: r.user_id, created_at: r.created_at, note: r.note,
    current_full_name: r.current_full_name, current_company_name: r.current_company_name, full_name: r.full_name, company_name: r.company_name,
    role: one(r.user as unknown as { role: string })?.role ?? null,
  }));

  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (role) sp.set('role', role);
    if (status) sp.set('status', status);
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    return `/admin/users${s ? `?${s}` : ''}`;
  };

  const tiles = [
    { label: 'Registered accounts', value: totalCount.count ?? 0, icon: Users, tone: 'tone-active' },
    { label: 'Banned', value: bannedCount.count ?? 0, icon: UserX, tone: 'tone-danger' },
    { label: 'Profile edits to review', value: pendingCount.count ?? 0, icon: UserCog, tone: 'tone-pending' },
  ];

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-8">
        <p className="eyebrow">Internal · Accounts</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Users</h1>
        <p className="mt-1 text-sm text-neutral-500">Importers, suppliers and admins. Bans take effect immediately; profile edits wait for your approval.</p>

        {migrationMissing && (
          <p role="alert" className="tone-pending mt-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Run <code className="font-mono">supabase/migrations/012_user_management.sql</code> in the Supabase SQL editor to enable user management.
          </p>
        )}

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {tiles.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="card card-lift flex items-center gap-4 p-5">
              <span className={clsx('grid h-10 w-10 place-items-center rounded-lg border', tone)}><Icon className="h-5 w-5" aria-hidden /></span>
              <div>
                <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{value.toLocaleString('en-US')}</dd>
                <dt className="text-sm text-neutral-500">{label}</dt>
              </div>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Directory */}
          <section aria-labelledby="directory" className="card min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
              <h2 id="directory" className="font-semibold text-neutral-900">Directory</h2>
              <form role="search" action="/admin/users" className="flex flex-1 flex-wrap justify-end gap-2">
                <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                  <input name="q" defaultValue={q} placeholder="Name, business or email" aria-label="Search users" className="input py-2 pl-9" />
                </div>
                <select name="role" defaultValue={role} aria-label="Account type" className="input w-auto py-2">
                  {ROLE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select name="status" defaultValue={status} aria-label="Status" className="input w-auto py-2">
                  {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className="btn-secondary py-2">Filter</button>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs text-neutral-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">User</th>
                    <th scope="col" className="px-4 py-3 font-medium">Account type</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-500">{q || role || status ? 'No users match these filters.' : 'No users yet.'}</td></tr>
                  )}
                  {rows.map((u) => {
                    const st = userStatus(u);
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500/15 to-cyan-500/15 text-xs font-semibold text-neutral-800 ring-1 ring-neutral-200">{initials(u.full_name)}</span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-neutral-900">{u.full_name}</p>
                              <p className="truncate text-xs text-neutral-500">{u.email ?? '—'} · {u.company_name}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {ROLE_LABEL[u.role] ?? u.role}
                          {u.grant_id && u.grant_expires_at && (
                            <span className="pill ml-1.5 border-violet-300 bg-violet-50 text-violet-800" title={`Temporary admin until ${new Date(u.grant_expires_at).toLocaleString('en-GB')}`}>
                              Temp admin · {formatTimeLeft(u.grant_expires_at)}
                            </span>
                          )}
                          <span className="block text-xs text-neutral-500">{flag(u.country_code)} {countryName(u.country_code)}{u.kyc_verified ? ' · KYC verified' : ''}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('pill', st.tone)} title={u.is_banned && u.ban_reason ? `Reason: ${u.ban_reason}` : undefined}>
                            {st.status === 'active' ? <UserCheck className="h-3 w-3" aria-hidden /> : st.status === 'banned' ? <UserX className="h-3 w-3" aria-hidden /> : st.status === 'frozen' ? <Snowflake className="h-3 w-3" aria-hidden /> : <UserCog className="h-3 w-3" aria-hidden />}
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-600">
                          {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          <span className="block text-neutral-500">{u.last_sign_in_at ? `Last seen ${new Date(u.last_sign_in_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Never signed in'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <UserActions userId={u.id} name={u.full_name} isBanned={u.is_banned} isAdmin={u.role === 'admin' || u.role === 'super_admin'} isSelf={u.id === user.id} />
                            {viewerIsSuper && u.id !== user.id && <MessageUserButton userId={u.id} name={u.full_name} />}
                            {viewerIsSuper && u.id !== user.id && (
                              <SuperUserControls userId={u.id} name={u.full_name} targetIsAdmin={u.role === 'admin' || u.role === 'super_admin'}
                                targetIsSuper={u.role === 'super_admin'} isFrozen={!!u.is_frozen} grantId={u.grant_id ?? null} grantExpiresAt={u.grant_expires_at ?? null} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <p>{total === 0 ? 'Showing 0 users' : `Showing ${(page - 1) * USER_PAGE_SIZE + 1} to ${Math.min(page * USER_PAGE_SIZE, total)} of ${total.toLocaleString('en-US')} users`}</p>
              {totalPages > 1 && (
                <nav aria-label="User pages" className="flex items-center gap-1">
                  <PageLink href={href(page - 1)} disabled={page <= 1} label="Previous page"><ChevronLeft className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Previous</span></PageLink>
                  {pageList(page, totalPages).map((p, i) => p === '…'
                    ? <span key={`gap-${i}`} className="px-1.5 text-neutral-400" aria-hidden>…</span>
                    : <PageLink key={p} href={href(p)} current={p === page} label={`Page ${p}`}>{p}</PageLink>)}
                  <PageLink href={href(page + 1)} disabled={page >= totalPages} label="Next page"><span className="hidden sm:inline">Next</span> <ChevronRight className="h-3.5 w-3.5" aria-hidden /></PageLink>
                </nav>
              )}
            </div>
          </section>

          {/* Profile change queue */}
          <section aria-labelledby="changes">
            <h2 id="changes" className="flex items-center gap-2 font-semibold text-neutral-900">
              <UserCog className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden /> Profile change requests
              <span className="pill tone-pending">{pendingCount.count ?? 0}</span>
            </h2>
            <p className="mt-1 text-xs text-neutral-500">Oldest first. Approving copies the new details to the live profile.</p>
            <ul className="mt-3 space-y-3">
              {requests.length === 0 && <li className="card px-4 py-8 text-center text-sm text-neutral-500">No pending edits.</li>}
              {requests.map((r) => <ChangeRequestCard key={r.id} request={r} />)}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}

function PageLink({ href, current, disabled, label, children }: {
  href: string; current?: boolean; disabled?: boolean; label: string; children: React.ReactNode;
}) {
  const cls = clsx('press inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums',
    current ? 'bg-blue-600 text-snow' : 'text-neutral-700 hover:bg-neutral-100', disabled && 'pointer-events-none opacity-40');
  if (disabled) return <span className={cls} aria-disabled="true" aria-label={label}>{children}</span>;
  return <Link href={href} className={cls} aria-label={label} aria-current={current ? 'page' : undefined}>{children}</Link>;
}
