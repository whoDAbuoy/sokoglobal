-- =============================================================================
-- SokoGlobal — Migration 040: terms acceptance records and self-service account closure. Run after 039.
-- Re-runnable.
--
--  * profiles.terms_version / terms_accepted_at: which Terms of Trade, Escrow Agreement and Privacy Policy
--    (lib/legal.ts LEGAL_VERSION) the account accepted, and when. Sign-up already sends both in the auth
--    metadata; a BEFORE INSERT trigger copies them onto the new profile, and existing accounts are backfilled
--    from their metadata. accept_terms(version) records a (re-)acceptance with the database clock.
--  * my_account_closure_blockers(): what stops the caller closing their account right now: money in flight
--    (unfinished orders as buyer or supplier, paid Trend Pool pledges, payouts processing or on hold, wire /
--    crypto transfers under review) or a staff role.
--  * close_my_account(): the owner closes their own account. Records that must be kept (orders, payments,
--    payouts, KYC: Privacy Policy §7) stay, but the profile is anonymised, listings archived, follows,
--    notifications and 2FA secrets removed, and the account is banned so it cannot sign in. Returns
--    has_history = false when nothing needs keeping, so the server can delete the auth user outright.
--    Each closure is written to admin_user_log ('close_account').
-- =============================================================================

alter table public.profiles add column if not exists terms_version     text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists closed_at         timestamptz;
alter table public.profiles drop constraint if exists profiles_terms_version_format;
alter table public.profiles add constraint profiles_terms_version_format
  check (terms_version is null or terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- ── 1. Acceptance from sign-up metadata ─────────────────────────────────────
create or replace function public.profiles_terms_from_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb;
begin
  if new.terms_version is not null then return new; end if;
  select raw_user_meta_data into m from auth.users where id = new.id;
  if m ->> 'terms_version' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    new.terms_version := m ->> 'terms_version';
    -- The browser's timestamp is only trusted to within a day of now(); otherwise the insert time is used.
    begin
      new.terms_accepted_at := (m ->> 'terms_accepted_at')::timestamptz;
    exception when others then new.terms_accepted_at := null;
    end;
    if new.terms_accepted_at is null or abs(extract(epoch from new.terms_accepted_at - now())) > 86400 then
      new.terms_accepted_at := now();
    end if;
  end if;
  return new;
end $$;
revoke all on function public.profiles_terms_from_signup() from public, anon, authenticated;
drop trigger if exists profiles_terms_from_signup on public.profiles;
create trigger profiles_terms_from_signup before insert on public.profiles
  for each row execute function public.profiles_terms_from_signup();

update public.profiles p
   set terms_version = u.raw_user_meta_data ->> 'terms_version',
       terms_accepted_at = coalesce(
         case when u.raw_user_meta_data ->> 'terms_accepted_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              then (u.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz end,
         u.created_at)
  from auth.users u
 where u.id = p.id and p.terms_version is null
   and u.raw_user_meta_data ->> 'terms_version' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

create or replace function public.accept_terms(p_version text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Unknown terms version'; end if;
  update public.profiles set terms_version = p_version, terms_accepted_at = now()
   where id = auth.uid() returning terms_accepted_at into v_at;
  if v_at is null then raise exception 'Profile not found'; end if;
  return v_at;
end $$;
revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- ── 2. Account closure ──────────────────────────────────────────────────────
alter table public.admin_user_log drop constraint if exists admin_user_log_action_check;
alter table public.admin_user_log add constraint admin_user_log_action_check
  check (action in ('ban', 'unban', 'approve_profile_change', 'reject_profile_change', 'delete_user', 'close_account'));

create or replace function public.account_closure_blockers(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '{}'::jsonb; n integer;
begin
  if exists (select 1 from public.profiles where id = p_user_id and role::text in ('admin', 'super_admin')) then
    return jsonb_build_object('staff', 1);
  end if;
  select count(*) into n from public.orders
   where buyer_id = p_user_id and escrow_status::text not in ('released', 'refunded', 'cancelled');
  if n > 0 then v := v || jsonb_build_object('open_orders', n); end if;
  select count(*) into n from public.orders o join public.products p on p.id = o.product_id
   where p.supplier_id = p_user_id and o.escrow_status::text not in ('released', 'refunded', 'cancelled', 'pending_payment');
  if n > 0 then v := v || jsonb_build_object('open_sales', n); end if;
  select count(*) into n from public.pool_members m join public.trend_pools tp on tp.id = m.pool_id
   where m.buyer_id = p_user_id and tp.status::text in ('open', 'funded', 'ordered', 'shipped');
  if n > 0 then v := v || jsonb_build_object('pool_pledges', n); end if;
  select count(*) into n from public.payouts where supplier_id = p_user_id and status::text in ('processing', 'on_hold');
  if n > 0 then v := v || jsonb_build_object('payouts', n); end if;
  if to_regclass('public.manual_payments') is not null then
    execute 'select count(*) from public.manual_payments where buyer_id = $1 and status in (''awaiting'', ''submitted'')' into n using p_user_id;
    if n > 0 then v := v || jsonb_build_object('transfers', n); end if;
  end if;
  return v;
end $$;
revoke all on function public.account_closure_blockers(uuid) from public, anon, authenticated;

create or replace function public.my_account_closure_blockers()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then jsonb_build_object('signed_out', 1) else public.account_closure_blockers(auth.uid()) end
$$;
revoke all on function public.my_account_closure_blockers() from public, anon;
grant execute on function public.my_account_closure_blockers() to authenticated;

create or replace function public.close_my_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := auth.uid();
  v_blockers jsonb;
  v_history boolean;
  v_snapshot jsonb;
begin
  if v_id is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  -- One closure at a time per account; also stops new orders racing the checks below.
  perform 1 from public.profiles where id = v_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if exists (select 1 from public.profiles where id = v_id and closed_at is not null) then
    return jsonb_build_object('closed', true, 'has_history', true);
  end if;
  v_blockers := public.account_closure_blockers(v_id);
  if v_blockers <> '{}'::jsonb then
    raise exception 'Account cannot be closed yet: %', v_blockers::text using errcode = '55000';
  end if;

  v_history := exists (select 1 from public.orders where buyer_id = v_id)
            or exists (select 1 from public.products where supplier_id = v_id)
            or exists (select 1 from public.pool_members where buyer_id = v_id)
            or exists (select 1 from public.payouts where supplier_id = v_id)
            or exists (select 1 from public.card_payments where buyer_id = v_id);

  select jsonb_build_object('full_name', full_name, 'company_name', company_name, 'role', role, 'country_code', country_code)
    into v_snapshot from public.profiles where id = v_id;

  -- Anonymise the profile and block sign-in (the middleware signs banned sessions out).
  update public.profiles
     set full_name = 'Closed account', company_name = 'Closed account',
         phone_number = null, designation = null, bio = null, avatar_url = null,
         sms_alerts = false, email_notifications = false,
         is_banned = true, banned_at = now(), ban_reason = 'Closed by the account owner', closed_at = now()
   where id = v_id;

  update public.products set status = 'archived' where supplier_id = v_id and status::text <> 'archived';
  delete from public.follows where follower_id = v_id or following_id = v_id;
  delete from public.user_notifications where user_id = v_id;
  delete from public.user_totp_secrets where user_id = v_id;
  delete from public.two_factor_sessions where user_id = v_id;
  update public.profile_change_requests set status = 'cancelled' where user_id = v_id and status = 'pending';

  insert into public.admin_user_log (admin_id, target_user_id, action, detail)
  values (v_id, v_id, 'close_account', v_snapshot || jsonb_build_object('has_history', v_history));

  return jsonb_build_object('closed', true, 'has_history', v_history);
end $$;
revoke all on function public.close_my_account() from public, anon;
grant execute on function public.close_my_account() to authenticated;
