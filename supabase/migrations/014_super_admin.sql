-- =============================================================================
-- SokoGlobal — Migration 014: super admins, delegated (temporary) admins,
-- account freezes, platform kill switch, audited overrides. Run after 013.
-- Re-runnable. Run 015_catalog.sql after this one.
--
-- Model
--  * profiles.role gains 'super_admin'. Make the first one by hand:
--      update public.profiles set role = 'super_admin' where id = '<your user id>';
--  * current_role_is('admin') is now TRUE for admins, super admins and users
--    with an unexpired, unrevoked delegated_admin_grants row (checked against
--    now() on every call). Every existing admin RLS policy and admin_* function
--    therefore accepts super admins and delegates without being rewritten.
--  * Super admins do NOT get a blanket RLS bypass from the browser. Their extra
--    powers are explicit SECURITY DEFINER functions (super_*) that re-check
--    is_super_admin() and write admin_audit_logs (append-only, with IP).
-- =============================================================================

alter type public.user_role add value if not exists 'super_admin';

-- ── 1. Delegated admin grants ───────────────────────────────────────────────
create table if not exists public.delegated_admin_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null,
  reason      text check (reason is null or char_length(reason) <= 500),
  constraint grant_expires_after_start check (expires_at > granted_at)
);
create index if not exists delegated_admin_active_idx on public.delegated_admin_grants (user_id, expires_at) where revoked_at is null;

-- Is the caller's admin access real right now? (role or live grant; banned users never)
create or replace function public.current_role_is(r public.user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when r::text = 'admin' then
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('admin', 'super_admin') and not coalesce(p.is_banned, false))
      or exists (select 1 from public.delegated_admin_grants g join public.profiles p on p.id = g.user_id
                  where g.user_id = auth.uid() and g.revoked_at is null and now() < g.expires_at and not coalesce(p.is_banned, false))
    else exists (select 1 from public.profiles where id = auth.uid() and role = r)
  end
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'super_admin' and not coalesce(is_banned, false))
$$;

-- Permanent admins (role admin / super_admin) — delegates are excluded from the kill switch.
create or replace function public.is_permanent_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('admin', 'super_admin') and not coalesce(is_banned, false))
$$;

-- What the app shows in the header/nav: 'super' | 'admin' | 'delegated' | null (+ grant expiry).
create or replace function public.my_admin_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles where id = auth.uid() and role::text = 'super_admin' and not coalesce(is_banned, false)) then jsonb_build_object('level', 'super')
    when exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin' and not coalesce(is_banned, false)) then jsonb_build_object('level', 'admin')
    else (select jsonb_build_object('level', 'delegated', 'expires_at', g.expires_at, 'grant_id', g.id)
            from public.delegated_admin_grants g join public.profiles p on p.id = g.user_id
           where g.user_id = auth.uid() and g.revoked_at is null and now() < g.expires_at and not coalesce(p.is_banned, false)
           order by g.expires_at desc limit 1)
  end
$$;

alter table public.delegated_admin_grants enable row level security;
drop policy if exists "grants: own read" on public.delegated_admin_grants;
drop policy if exists "grants: admin read" on public.delegated_admin_grants;
create policy "grants: own read" on public.delegated_admin_grants for select using (user_id = (select auth.uid()));
create policy "grants: admin read" on public.delegated_admin_grants for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.delegated_admin_grants from authenticated, anon;

-- ── 2. Immutable audit trail ────────────────────────────────────────────────
create table if not exists public.admin_audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                -- no FK: survives account deletion
  actor_level text,                -- super | admin | delegated | system
  action      text not null check (char_length(action) between 2 and 80),
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  ip          text check (ip is null or char_length(ip) <= 64),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 400),
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx on public.admin_audit_logs (target_type, target_id, created_at desc);

create or replace function public.audit_logs_immutable()
returns trigger language plpgsql as $$
begin raise exception 'admin_audit_logs is append-only'; end $$;
drop trigger if exists admin_audit_logs_no_change on public.admin_audit_logs;
create trigger admin_audit_logs_no_change before update or delete on public.admin_audit_logs
  for each row execute function public.audit_logs_immutable();

alter table public.admin_audit_logs enable row level security;
drop policy if exists "audit: admin read" on public.admin_audit_logs;
create policy "audit: admin read" on public.admin_audit_logs for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update, delete, truncate on public.admin_audit_logs from authenticated, anon;

create or replace function public.caller_admin_level()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.my_admin_access() ->> 'level', case when auth.uid() is null then 'system' else 'none' end)
$$;

-- Internal writer used by every super_* function and the log_admin_action RPC.
create or replace function public.write_admin_audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb, p_ip text, p_ua text)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_logs (actor_id, actor_level, action, target_type, target_id, detail, ip, user_agent)
  values (auth.uid(), public.caller_admin_level(), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb), left(p_ip, 64), left(p_ua, 400));
$$;
revoke all on function public.write_admin_audit(text, text, text, jsonb, text, text) from public, anon, authenticated;

-- App-side logging (e.g. read-only View-As sessions, payouts started from the console).
create or replace function public.log_admin_action(p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb, p_ip text default null, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  perform public.write_admin_audit(p_action, p_target_type, p_target_id, p_detail, p_ip, p_ua);
end $$;

-- Mirror the user-moderation log (migration 012) into the unified trail.
create or replace function public.mirror_admin_user_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_audit_logs (actor_id, actor_level, action, target_type, target_id, detail)
  values (new.admin_id, public.caller_admin_level(), 'user.' || new.action, 'user', new.target_user_id::text, new.detail);
  return new;
end $$;
drop trigger if exists admin_user_log_mirror on public.admin_user_log;
create trigger admin_user_log_mirror after insert on public.admin_user_log for each row execute function public.mirror_admin_user_log();

-- ── 3. Grant / revoke temporary admin (super admins only) ───────────────────
create or replace function public.super_grant_admin(p_user_id uuid, p_expires_at timestamptz, p_reason text, p_ip text default null, p_ua text default null)
returns public.delegated_admin_grants
language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_row public.delegated_admin_grants;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  if v_target.role::text in ('admin', 'super_admin') then raise exception 'This account is already an admin'; end if;
  if v_target.is_banned then raise exception 'Banned accounts cannot be given admin access'; end if;
  if p_expires_at < now() + interval '5 minutes' or p_expires_at > now() + interval '30 days' then
    raise exception 'Choose an expiry between 5 minutes and 30 days from now';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason (5+ characters)'; end if;

  update public.delegated_admin_grants set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and revoked_at is null and expires_at > now();
  insert into public.delegated_admin_grants (user_id, granted_by, expires_at, reason)
  values (p_user_id, auth.uid(), p_expires_at, left(btrim(p_reason), 500)) returning * into v_row;
  perform public.write_admin_audit('admin.grant', 'user', p_user_id::text,
    jsonb_build_object('grant_id', v_row.id, 'expires_at', v_row.expires_at, 'reason', v_row.reason), p_ip, p_ua);
  return v_row;
end $$;

create or replace function public.super_revoke_admin(p_grant_id uuid, p_ip text default null, p_ua text default null)
returns public.delegated_admin_grants
language plpgsql security definer set search_path = public as $$
declare v_row public.delegated_admin_grants;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  update public.delegated_admin_grants set revoked_at = now(), revoked_by = auth.uid()
   where id = p_grant_id and revoked_at is null returning * into v_row;
  if not found then raise exception 'Grant not found or already revoked'; end if;
  perform public.write_admin_audit('admin.revoke', 'user', v_row.user_id::text, jsonb_build_object('grant_id', v_row.id), p_ip, p_ua);
  return v_row;
end $$;

-- Bans / deletes must never target super admins either (redefines the 012 versions).
create or replace function public.admin_set_user_ban(p_user_id uuid, p_banned boolean, p_reason text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot ban your own account'; end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if v_target.role::text in ('admin', 'super_admin') then raise exception 'Admin accounts cannot be banned here'; end if;

  update public.profiles
     set is_banned = p_banned,
         banned_at = case when p_banned then now() else null end,
         ban_reason = case when p_banned then nullif(left(btrim(coalesce(p_reason, '')), 500), '') else null end,
         updated_at = now()
   where id = p_user_id
  returning * into v_target;
  if p_banned then   -- a ban also ends any temporary admin access
    update public.delegated_admin_grants set revoked_at = now(), revoked_by = auth.uid() where user_id = p_user_id and revoked_at is null;
  end if;

  insert into public.admin_user_log (admin_id, target_user_id, action, detail)
  values (auth.uid(), p_user_id, case when p_banned then 'ban' else 'unban' end, jsonb_build_object('reason', v_target.ban_reason));
  return v_target;
end $$;

create or replace function public.admin_user_deletion_blockers(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '{}'::jsonb; n integer;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then return jsonb_build_object('self', 1); end if;
  if exists (select 1 from public.profiles where id = p_user_id and role::text in ('admin', 'super_admin')) then return jsonb_build_object('admin', 1); end if;
  select count(*) into n from public.orders where buyer_id = p_user_id;        if n > 0 then v := v || jsonb_build_object('orders', n); end if;
  select count(*) into n from public.products where supplier_id = p_user_id;   if n > 0 then v := v || jsonb_build_object('products', n); end if;
  select count(*) into n from public.pool_members where buyer_id = p_user_id;  if n > 0 then v := v || jsonb_build_object('pool_pledges', n); end if;
  select count(*) into n from public.payouts where supplier_id = p_user_id;    if n > 0 then v := v || jsonb_build_object('payouts', n); end if;
  return v;
end $$;

-- ── 4. Account freeze (disputes): can sign in and message, cannot order, pay, pledge or be paid out ──
alter table public.profiles add column if not exists is_frozen     boolean not null default false;
alter table public.profiles add column if not exists frozen_at     timestamptz;
alter table public.profiles add column if not exists freeze_reason text check (freeze_reason is null or char_length(freeze_reason) <= 500);

create or replace function public.guard_not_frozen()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_subject uuid;
begin
  -- payouts are inserted by the service role on behalf of the supplier → check the row's supplier.
  if tg_table_name = 'payouts' then v_subject := new.supplier_id; else v_subject := auth.uid(); end if;
  if v_subject is not null and exists (select 1 from public.profiles where id = v_subject and is_frozen) then
    raise exception 'This account is frozen pending review. Contact SokoGlobal support.' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'checkout_groups', 'pool_members', 'card_payments', 'mpesa_payments', 'payouts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_not_frozen', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.guard_not_frozen()', t || '_not_frozen', t);
    end if;
  end loop;
end $$;

create or replace function public.super_set_account_frozen(p_user_id uuid, p_frozen boolean, p_reason text, p_ip text default null, p_ua text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v public.profiles;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot freeze your own account'; end if;
  if p_frozen and char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason (5+ characters)'; end if;
  update public.profiles set is_frozen = p_frozen, frozen_at = case when p_frozen then now() end,
         freeze_reason = case when p_frozen then left(btrim(p_reason), 500) end, updated_at = now()
   where id = p_user_id and role::text <> 'super_admin' returning * into v;
  if not found then raise exception 'User not found (super admins cannot be frozen)'; end if;
  perform public.write_admin_audit(case when p_frozen then 'account.freeze' else 'account.unfreeze' end, 'user', p_user_id::text,
    jsonb_build_object('reason', p_reason), p_ip, p_ua);
  return v;
end $$;

-- ── 5. Platform kill switch ─────────────────────────────────────────────────
create table if not exists public.platform_settings (
  id               boolean primary key default true check (id),
  pause_new_orders boolean not null default false,
  pause_checkout   boolean not null default false,
  maintenance_mode boolean not null default false,
  banner_message   text check (banner_message is null or char_length(banner_message) <= 300),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "settings: everyone reads" on public.platform_settings;
create policy "settings: everyone reads" on public.platform_settings for select using (true);
revoke insert, update, delete on public.platform_settings from authenticated, anon;
grant select on public.platform_settings to anon, authenticated;

create or replace function public.guard_platform_open()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.platform_settings;
begin
  select * into s from public.platform_settings where id;
  if not found or auth.uid() is null then return new; end if;            -- webhooks / service role keep working
  if s.maintenance_mode then raise exception 'SokoGlobal is in maintenance mode. Please try again shortly.' using errcode = '55000'; end if;
  if tg_table_name in ('orders', 'checkout_groups', 'pool_members') and s.pause_new_orders then
    raise exception 'New orders are paused right now. Please try again later.' using errcode = '55000';
  end if;
  if tg_table_name in ('card_payments', 'mpesa_payments') and s.pause_checkout then
    raise exception 'Checkout is paused right now. Your order is saved; please try again later.' using errcode = '55000';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'checkout_groups', 'pool_members', 'card_payments', 'mpesa_payments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_platform_open', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.guard_platform_open()', t || '_platform_open', t);
    end if;
  end loop;
end $$;

create or replace function public.admin_set_platform_settings(p_pause_new_orders boolean, p_pause_checkout boolean, p_maintenance_mode boolean,
  p_banner_message text, p_ip text default null, p_ua text default null)
returns public.platform_settings language plpgsql security definer set search_path = public as $$
declare v public.platform_settings; v_old public.platform_settings;
begin
  if not public.is_permanent_admin() then raise exception 'Only permanent admins can change platform switches' using errcode = '42501'; end if;
  select * into v_old from public.platform_settings where id;
  update public.platform_settings set pause_new_orders = p_pause_new_orders, pause_checkout = p_pause_checkout, maintenance_mode = p_maintenance_mode,
         banner_message = nullif(left(btrim(coalesce(p_banner_message, '')), 300), ''), updated_at = now(), updated_by = auth.uid()
   where id returning * into v;
  perform public.write_admin_audit('platform.settings', 'platform', 'settings',
    jsonb_build_object('from', to_jsonb(v_old) - 'updated_by', 'to', to_jsonb(v) - 'updated_by'), p_ip, p_ua);
  return v;
end $$;

-- ── 6. Order & escrow overrides (super admins) ──────────────────────────────
alter table public.orders add column if not exists tracking_number text check (tracking_number is null or char_length(tracking_number) <= 80);
alter table public.orders add column if not exists carrier         text check (carrier is null or char_length(carrier) <= 80);

create table if not exists public.financial_overrides (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete restrict,
  action       text not null check (action in ('force_release', 'refund_full', 'refund_partial', 'manual_payout', 'landed_cost_edit')),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  provider     text,
  provider_ref text,
  status       text not null default 'recorded' check (status in ('recorded', 'sent', 'manual_required', 'failed')),
  reason       text not null check (char_length(reason) between 5 and 1000),
  actor_id     uuid,
  created_at   timestamptz not null default now()
);
create index if not exists financial_overrides_order_idx on public.financial_overrides (order_id, created_at desc);
alter table public.financial_overrides enable row level security;
drop policy if exists "fin_overrides: admin read" on public.financial_overrides;
create policy "fin_overrides: admin read" on public.financial_overrides for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.financial_overrides from authenticated, anon;

create or replace function public.require_super_reason(p_reason text)
returns text language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Give a reason (5+ characters) — it is written to the audit trail'; end if;
  return left(btrim(p_reason), 1000);
end $$;

-- Force-release escrow (the app then starts the normal supplier payout).
create or replace function public.super_force_release(p_order_id uuid, p_reason text, p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders; v_reason text := public.require_super_reason(p_reason); v_from text;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select escrow_status::text into v_from from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_from not in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed') then
    raise exception 'Only orders held in escrow can be released (this one is %)', v_from;
  end if;
  update public.orders set escrow_status = 'released', released_at = now(), verified_at = coalesce(verified_at, now()) where id = p_order_id returning * into v;
  update public.escrow_events set note = 'Force-released by super admin: ' || v_reason
   where id = (select max(id) from public.escrow_events where order_id = p_order_id and to_status = 'released');
  insert into public.financial_overrides (order_id, action, amount_cents, reason, actor_id) values (p_order_id, 'force_release', v.goods_cents, v_reason, auth.uid());
  perform public.write_admin_audit('escrow.force_release', 'order', p_order_id::text, jsonb_build_object('from', v_from, 'reason', v_reason), p_ip, p_ua);
  return v;
end $$;

-- Record a refund. Full refunds close the order as 'refunded'; partial refunds leave it where it is.
-- The app performs the Paystack refund first and passes its id; M-Pesa refunds are 'manual_required'.
create or replace function public.super_record_refund(p_order_id uuid, p_amount_cents integer, p_full boolean, p_provider text, p_provider_ref text,
  p_status text, p_reason text, p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders; v_reason text := public.require_super_reason(p_reason);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v.escrow_status::text not in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed') then
    raise exception 'Refunds are only possible while funds are held in escrow (order is %)', v.escrow_status;
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > v.total_cents then raise exception 'Refund amount must be between 1 cent and the order total'; end if;
  if p_status not in ('sent', 'manual_required', 'failed') then raise exception 'Invalid refund status'; end if;

  insert into public.financial_overrides (order_id, action, amount_cents, provider, provider_ref, status, reason, actor_id)
  values (p_order_id, case when p_full then 'refund_full' else 'refund_partial' end, p_amount_cents, p_provider, p_provider_ref, p_status, v_reason, auth.uid());
  if p_full and p_status <> 'failed' then
    update public.orders set escrow_status = 'refunded' where id = p_order_id returning * into v;
  end if;
  perform public.write_admin_audit(case when p_full then 'escrow.refund_full' else 'escrow.refund_partial' end, 'order', p_order_id::text,
    jsonb_build_object('amount_cents', p_amount_cents, 'provider', p_provider, 'provider_ref', p_provider_ref, 'status', p_status, 'reason', v_reason), p_ip, p_ua);
  return v;
end $$;

-- Edit the landed-cost breakdown — only before any money is taken (pending, not part of a cart, no open payment).
create or replace function public.super_override_landed_cost(p_order_id uuid, p_goods integer, p_freight integer, p_customs integer, p_reason text,
  p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders; v_old public.orders; v_reason text := public.require_super_reason(p_reason);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_old.escrow_status <> 'pending_payment' then raise exception 'Landed cost can only change before payment'; end if;
  if v_old.checkout_group_id is not null then raise exception 'This order is part of a cart checkout; cancel and re-create the cart instead'; end if;
  if exists (select 1 from public.card_payments where order_id = p_order_id and status in ('initiated', 'review'))
     or exists (select 1 from public.mpesa_payments where order_id = p_order_id and status in ('initiating', 'pending', 'review')) then
    raise exception 'A payment is in progress for this order';
  end if;
  if p_goods < 0 or p_freight < 0 or p_customs < 0 then raise exception 'Amounts cannot be negative'; end if;
  update public.orders set goods_cents = p_goods, freight_cents = p_freight, customs_cents = p_customs where id = p_order_id returning * into v;
  insert into public.financial_overrides (order_id, action, amount_cents, reason, actor_id) values (p_order_id, 'landed_cost_edit', v.total_cents, v_reason, auth.uid());
  perform public.write_admin_audit('order.landed_cost', 'order', p_order_id::text,
    jsonb_build_object('from', jsonb_build_object('goods', v_old.goods_cents, 'freight', v_old.freight_cents, 'customs', v_old.customs_cents),
                       'to', jsonb_build_object('goods', p_goods, 'freight', p_freight, 'customs', p_customs), 'reason', v_reason), p_ip, p_ua);
  return v;
end $$;

-- Tracking number / carrier (shipment milestones keep using admin_set_shipment_tracking, which applies escrow effects).
create or replace function public.super_set_tracking_reference(p_order_id uuid, p_tracking_number text, p_carrier text, p_reason text,
  p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders; v_reason text := public.require_super_reason(p_reason);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  update public.orders set tracking_number = nullif(left(btrim(coalesce(p_tracking_number, '')), 80), ''),
         carrier = nullif(left(btrim(coalesce(p_carrier, '')), 80), ''), tracking_updated_at = now()
   where id = p_order_id returning * into v;
  if not found then raise exception 'Order not found'; end if;
  perform public.write_admin_audit('order.tracking_reference', 'order', p_order_id::text,
    jsonb_build_object('tracking_number', v.tracking_number, 'carrier', v.carrier, 'reason', v_reason), p_ip, p_ua);
  return v;
end $$;

-- ── 7. Directory (adds grant + freeze columns; replaces the 012 version) ────
drop function if exists public.admin_list_users(text, text, text, integer, integer);
create or replace function public.admin_list_users(
  p_query text default null, p_role text default null, p_status text default null,
  p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, full_name text, company_name text, email text, role public.user_role, country_code char(2),
  kyc_verified boolean, is_banned boolean, ban_reason text, created_at timestamptz, last_sign_in_at timestamptz,
  pending_change boolean, is_frozen boolean, grant_id uuid, grant_expires_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  return query
  with base as (
    select p.id, p.full_name, p.company_name, u.email::text as email, p.role, p.country_code, p.kyc_verified,
           p.is_banned, p.ban_reason, p.created_at, u.last_sign_in_at,
           exists (select 1 from public.profile_change_requests r where r.user_id = p.id and r.status = 'pending') as pending_change,
           p.is_frozen, g.id as grant_id, g.expires_at as grant_expires_at
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join lateral (select dg.id, dg.expires_at from public.delegated_admin_grants dg
                          where dg.user_id = p.id and dg.revoked_at is null and dg.expires_at > now()
                          order by dg.expires_at desc limit 1) g on true
     where (v_q is null or p.full_name ilike '%' || v_q || '%' or p.company_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%')
       and (p_role is null or p_role = '' or p.role::text = p_role
            or (p_role = 'admin' and (p.role::text = 'super_admin' or g.id is not null)))
  ), filtered as (
    select * from base b
     where p_status is null or p_status = ''
        or (p_status = 'active' and not b.is_banned and not b.is_frozen)
        or (p_status = 'banned' and b.is_banned)
        or (p_status = 'frozen' and b.is_frozen)
        or (p_status = 'pending_edit' and b.pending_change)
        or (p_status = 'temp_admin' and b.grant_id is not null)
  )
  select f.*, count(*) over () as total_count
    from filtered f order by f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.super_grant_admin(uuid, timestamptz, text, text, text)', 'public.super_revoke_admin(uuid, text, text)',
    'public.super_set_account_frozen(uuid, boolean, text, text, text)',
    'public.admin_set_platform_settings(boolean, boolean, boolean, text, text, text)',
    'public.super_force_release(uuid, text, text, text)',
    'public.super_record_refund(uuid, integer, boolean, text, text, text, text, text, text)',
    'public.super_override_landed_cost(uuid, integer, integer, integer, text, text, text)',
    'public.super_set_tracking_reference(uuid, text, text, text, text, text)',
    'public.log_admin_action(text, text, text, jsonb, text, text)',
    'public.admin_list_users(text, text, text, integer, integer)',
    'public.my_admin_access()', 'public.is_super_admin()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
