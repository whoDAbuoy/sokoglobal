-- =============================================================================
-- SokoGlobal — Migration 041: two-factor enforced by the database, supplier contact details private,
-- 2FA lockout, admin KPIs computed in SQL, and two schema facts for the generated types. Run after 040. Re-runnable.
--
--  * supplier_profiles: the columns other signed-in users may see of a supplier (company, country, KYC
--    flag, avatar, bio, member since). The "profiles: read suppliers" policy is dropped, so phone numbers,
--    ban / freeze reasons, KYC status and notification settings are readable only by the owner and admins.
--    Embeds keep working through the view: supplier:supplier_profiles!products_supplier_id_fkey (...).
--  * check_request(): PostgREST pre-request hook. A signed-in session that has 2FA switched on but has not
--    passed the code (two_factor_satisfied(), migration 016) can only read its own profile and the
--    platform settings the 2FA page needs; every other table, view and RPC is refused. Before this, the
--    2FA check lived only in the Next.js middleware, so a stolen password plus the public anon key could
--    call the API directly. Storage objects and the realtime tables get a matching restrictive policy.
--  * two_factor_failures: consecutive wrong codes per user. Every 5th wrong code locks the challenge for
--    15 minutes, doubling each time up to 24 hours; a correct code clears it (service role only).
--  * admin_order_metrics(): escrow, GMV, payment-method, category and buyer-cohort figures over ALL orders
--    (the overview used to sum the latest 2,000 in the browser), as the calling admin (RLS applies).
--  * NOT NULL on four generated columns, plus defaults for columns triggers always fill: facts the generated types need.
-- =============================================================================

-- ── 1. Supplier profiles: public columns only ───────────────────────────────
create or replace view public.supplier_profiles with (security_barrier = true) as
  select id, role, full_name, company_name, country_code, kyc_verified, avatar_url, bio, is_banned, created_at
    from public.profiles
   where role = 'supplier';
comment on view public.supplier_profiles is
  'Supplier columns any signed-in user may read (migration 041). Runs as the view owner, so it bypasses profiles RLS by design.';
revoke all on public.supplier_profiles from public, anon, authenticated;
grant select on public.supplier_profiles to authenticated, service_role;

drop policy if exists "profiles: read suppliers" on public.profiles;

-- The one policy that looked suppliers up in profiles under the caller's own RLS (030): use the view instead.
drop policy if exists "follows: create own" on public.follows;
create policy "follows: create own" on public.follows for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and exists (select 1 from public.supplier_profiles p where p.id = following_id and not coalesce(p.is_banned, false))
  );

-- ── 2. Two-factor enforced on every API request ─────────────────────────────
create or replace function public.check_request()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_path   text := coalesce(current_setting('request.path', true), '');
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if auth.uid() is null or public.two_factor_satisfied() then return; end if;
  -- What a session waiting for its code still needs: the ban / 2FA / admin state (middleware, /auth/2fa),
  -- its own profile (RLS limits it to the owner and admins) and the maintenance banner and display currency.
  if v_path in ('/rpc/my_security_state', '/rpc/my_admin_access', '/rpc/two_factor_satisfied') then return; end if;
  if v_method in ('GET', 'HEAD') and v_path in ('/profiles', '/platform_settings', '/exchange_rates', '/system_configs') then return; end if;
  raise exception 'Verify your two-factor code to continue' using errcode = '42501', hint = 'two_factor_required';
end $$;
revoke all on function public.check_request() from public;
grant execute on function public.check_request() to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.check_request''';
  end if;
end $$;
notify pgrst, 'reload config';

-- Storage and realtime do not go through PostgREST: same rule as a restrictive policy.
drop policy if exists "two-factor: verified sessions only" on storage.objects;
create policy "two-factor: verified sessions only" on storage.objects as restrictive for all to authenticated
  using ((select public.two_factor_satisfied())) with check ((select public.two_factor_satisfied()));
do $$
declare t text;
begin
  foreach t in array array['chat_messages', 'support_messages', 'user_notifications'] loop
    execute format('drop policy if exists "two-factor: verified sessions only" on public.%I', t);
    execute format('create policy "two-factor: verified sessions only" on public.%I as restrictive for select to authenticated using ((select public.two_factor_satisfied()))', t);
  end loop;
end $$;

-- ── 3. Two-factor lockout ───────────────────────────────────────────────────
create table if not exists public.two_factor_failures (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  failures     integer not null default 0 check (failures >= 0),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.two_factor_failures enable row level security;
revoke all on public.two_factor_failures from public, anon, authenticated;

-- When the challenge is locked for this user, else null.
create or replace function public.two_factor_locked_until(p_user uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select locked_until from public.two_factor_failures where user_id = p_user and locked_until > now()
$$;

-- Counts one wrong code; returns the new lock end when this failure triggers a lock. The count starts over
-- only after a quiet day that is not the tail of a lock, so waiting out a 24 h lock does not reset it.
create or replace function public.record_two_factor_failure(p_user uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_failures integer; v_until timestamptz;
begin
  insert into public.two_factor_failures as f (user_id, failures, updated_at) values (p_user, 1, now())
  on conflict (user_id) do update set
    failures = case when f.updated_at < now() - interval '24 hours'
                     and (f.locked_until is null or f.locked_until < now() - interval '24 hours') then 1 else f.failures + 1 end,
    updated_at = now()
  returning failures into v_failures;
  if v_failures % 5 = 0 then
    v_until := now() + least(interval '15 minutes' * power(2, least(v_failures / 5 - 1, 7)), interval '24 hours');
    update public.two_factor_failures set locked_until = v_until where user_id = p_user;
  end if;
  return v_until;
end $$;

create or replace function public.clear_two_factor_failures(p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.two_factor_failures where user_id = p_user
$$;

revoke all on function public.two_factor_locked_until(uuid) from public, anon, authenticated;
revoke all on function public.record_two_factor_failure(uuid) from public, anon, authenticated;
revoke all on function public.clear_two_factor_failures(uuid) from public, anon, authenticated;
grant execute on function public.two_factor_locked_until(uuid) to service_role;
grant execute on function public.record_two_factor_failure(uuid) to service_role;
grant execute on function public.clear_two_factor_failures(uuid) to service_role;

-- ── 4. Admin overview figures ───────────────────────────────────────────────
-- Paid orders = everything except unpaid checkouts and orders cancelled before payment (lib/admin-metrics.ts).
-- "month" / "prev_month" are the rolling 30-day windows ending at p_now; paid_days counts funded orders per UTC day.
drop function if exists public.admin_order_metrics(timestamptz);
create function public.admin_order_metrics(p_now timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v jsonb;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  with paid as (
    select o.buyer_id, o.escrow_status::text as status, o.total_cents::bigint as total_cents,
           coalesce(o.deposit_amount, o.total_cents)::bigint as deposit_cents, o.funded_at,
           coalesce(o.payment_provider, '') as provider, coalesce(p.category::text, 'other') as category
      from public.orders o
      left join public.products p on p.id = o.product_id
     where o.escrow_status::text <> 'pending_payment'
       and not (o.escrow_status::text = 'cancelled' and o.funded_at is null)
  ), buyers as (
    select buyer_id, count(*) as n from paid group by buyer_id
  )
  select jsonb_build_object(
    'paid_count', (select count(*) from paid),
    'gmv',        (select coalesce(sum(total_cents), 0) from paid),
    'held',       (select coalesce(sum(case when status = 'deposit_paid' then deposit_cents else total_cents end), 0) from paid
                    where status in ('deposit_paid', 'funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed')),
    'released',   (select coalesce(sum(total_cents), 0) from paid where status = 'released'),
    'refunded',   (select coalesce(sum(total_cents), 0) from paid where status in ('refunded', 'cancelled')),
    'disputed',   (select count(*) from paid where status = 'disputed'),
    'buyers',     (select count(*) from buyers),
    'repeat_buyers', (select count(*) from buyers where n > 1),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'cents', cents) order by cents desc), '[]'::jsonb)
                      from (select category, sum(total_cents) as cents from paid group by category) c),
    'month', (select jsonb_build_object('gmv', coalesce(sum(cents), 0),
                       'by_provider', coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'cents', cents, 'count', n)), '[]'::jsonb))
                from (select provider, sum(total_cents) as cents, count(*) as n
                        from paid where funded_at >= p_now - interval '30 days' and funded_at < p_now group by provider) m),
    'prev_month_gmv', (select coalesce(sum(total_cents), 0) from paid
                        where funded_at >= p_now - interval '60 days' and funded_at < p_now - interval '30 days'),
    'paid_days', (select coalesce(jsonb_object_agg(d, n), '{}'::jsonb)
                    from (select to_char(funded_at at time zone 'UTC', 'YYYY-MM-DD') as d, count(*) as n from paid
                           where funded_at >= date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC' - interval '6 days'
                           group by 1) x)
  ) into v;
  return v;
end $$;
revoke all on function public.admin_order_metrics(timestamptz) from public, anon;
grant execute on function public.admin_order_metrics(timestamptz) to authenticated;

-- ── 5. Schema facts the generated TypeScript types rely on (lib/supabase/database.types.ts) ──
-- Generated columns computed from NOT NULL inputs (or a CASE with an ELSE) are never null; say so, so they
-- aren't typed `| null`. SET NOT NULL is a no-op when already set, so this stays re-runnable.
alter table public.orders alter column total_cents set not null;
alter table public.orders alter column fulfillment_status set not null;
alter table public.products alter column trial_landed_cost_cents set not null;
alter table public.manual_payments alter column charge_cents set not null;
-- stamp_support_message() always sets the sender; defaults make that visible to callers (the trigger still wins).
alter table public.support_messages alter column sender_id set default auth.uid();
alter table public.support_messages alter column sender_role set default 'customer';
-- products_catalog_sync() sets the legacy category from category_id on every insert; callers never send it.
alter table public.products alter column category set default 'general';
