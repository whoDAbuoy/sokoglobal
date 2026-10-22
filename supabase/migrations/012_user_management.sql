-- =============================================================================
-- SokoGlobal — Migration 012: admin user management. Run after 011. Re-runnable.
--
--  * profiles.is_banned (+ banned_at, ban_reason). A banned account is signed
--    out by the middleware and blocked from creating orders, pool pledges,
--    checkouts, products, chats and support messages by BEFORE INSERT triggers
--    (defence in depth — the app also bans the account in Supabase Auth so it
--    cannot sign in or refresh its session).
--  * Profile edits need approval: users lose the direct UPDATE grant on
--    profiles.full_name / company_name and file a profile_change_requests row
--    through submit_profile_change(); an admin approves (changes are copied to
--    the live profile) or rejects it.
--  * Admin-only functions re-check current_role_is('admin') inside SQL, so the
--    server-action role check is not the only line of defence.
--  * admin_user_log: append-only audit of bans, reviews and deletions.
-- =============================================================================

-- ── 1. Ban flag ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_banned  boolean not null default false;
alter table public.profiles add column if not exists banned_at  timestamptz;
alter table public.profiles add column if not exists ban_reason text check (ban_reason is null or char_length(ban_reason) <= 500);
create index if not exists profiles_banned_idx on public.profiles (is_banned) where is_banned;

-- Users can no longer edit their profile row directly (no column is granted);
-- changes go through submit_profile_change() + admin approval.
revoke update on public.profiles from authenticated, anon;

-- Is the signed-in caller banned? (false for the service role / webhooks)
create or replace function public.caller_is_banned()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_banned from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.guard_not_banned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.caller_is_banned() then
    raise exception 'This account is suspended. Contact SokoGlobal support.' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'checkout_groups', 'pool_members', 'products', 'chat_threads', 'chat_messages',
                           'support_tickets', 'support_messages', 'mpesa_payments', 'card_payments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_not_banned', t);
      execute format('create trigger %I before insert on public.%I for each row execute function public.guard_not_banned()', t || '_not_banned', t);
    end if;
  end loop;
end $$;

-- ── 2. Audit log ────────────────────────────────────────────────────────────
create table if not exists public.admin_user_log (
  id             bigint generated always as identity primary key,
  admin_id       uuid,                 -- no FK: keep the row if the admin account is removed
  target_user_id uuid not null,        -- no FK: keep the row after the user is deleted
  action         text not null check (action in ('ban', 'unban', 'approve_profile_change', 'reject_profile_change', 'delete_user')),
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists admin_user_log_target_idx on public.admin_user_log (target_user_id, created_at desc);
alter table public.admin_user_log enable row level security;
drop policy if exists "admin_user_log: admin reads" on public.admin_user_log;
create policy "admin_user_log: admin reads" on public.admin_user_log for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.admin_user_log from authenticated, anon;

-- ── 3. Profile change requests ──────────────────────────────────────────────
create table if not exists public.profile_change_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  current_full_name    text not null,
  current_company_name text not null,
  full_name            text not null check (char_length(full_name) between 2 and 120),
  company_name         text not null check (char_length(company_name) between 2 and 160),
  note                 text check (note is null or char_length(note) <= 500),
  review_note          text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by          uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  reviewed_at          timestamptz
);
create unique index if not exists profile_change_one_pending on public.profile_change_requests (user_id) where status = 'pending';
create index if not exists profile_change_queue_idx on public.profile_change_requests (status, created_at);

alter table public.profile_change_requests enable row level security;
drop policy if exists "profile_changes: owner reads" on public.profile_change_requests;
drop policy if exists "profile_changes: admin reads" on public.profile_change_requests;
create policy "profile_changes: owner reads" on public.profile_change_requests for select using (user_id = (select auth.uid()));
create policy "profile_changes: admin reads" on public.profile_change_requests for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.profile_change_requests from authenticated, anon;

-- File (or replace) the caller's pending change request.
create or replace function public.submit_profile_change(p_full_name text, p_company_name text, p_note text default null)
returns public.profile_change_requests
language plpgsql security definer set search_path = public as $$
declare
  v_me    public.profiles;
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_co    text := btrim(coalesce(p_company_name, ''));
  v_row   public.profile_change_requests;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_me.is_banned then raise exception 'This account is suspended. Contact SokoGlobal support.' using errcode = '42501'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'Name must be 2–120 characters'; end if;
  if char_length(v_co) not between 2 and 160 then raise exception 'Business name must be 2–160 characters'; end if;
  if v_name = v_me.full_name and v_co = v_me.company_name then raise exception 'Nothing to change'; end if;

  update public.profile_change_requests set status = 'cancelled', reviewed_at = now()
   where user_id = v_me.id and status = 'pending';

  insert into public.profile_change_requests (user_id, current_full_name, current_company_name, full_name, company_name, note)
  values (v_me.id, v_me.full_name, v_me.company_name, v_name, v_co, nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.cancel_profile_change()
returns void language sql security definer set search_path = public as $$
  update public.profile_change_requests set status = 'cancelled', reviewed_at = now()
   where user_id = auth.uid() and status = 'pending';
$$;

-- Approve (copy to the live profile) or reject a pending request.
create or replace function public.admin_review_profile_change(p_request_id uuid, p_approve boolean, p_note text default null)
returns public.profile_change_requests
language plpgsql security definer set search_path = public as $$
declare v_row public.profile_change_requests;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into v_row from public.profile_change_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_row.status <> 'pending' then raise exception 'This request was already %', v_row.status; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Add a short reason (5+ characters) so the user knows what to fix';
  end if;

  if p_approve then
    update public.profiles set full_name = v_row.full_name, company_name = v_row.company_name, updated_at = now()
     where id = v_row.user_id;
  end if;

  update public.profile_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_request_id
  returning * into v_row;

  insert into public.admin_user_log (admin_id, target_user_id, action, detail)
  values (auth.uid(), v_row.user_id, case when p_approve then 'approve_profile_change' else 'reject_profile_change' end,
          jsonb_build_object('request_id', v_row.id, 'from', jsonb_build_object('full_name', v_row.current_full_name, 'company_name', v_row.current_company_name),
                             'to', jsonb_build_object('full_name', v_row.full_name, 'company_name', v_row.company_name), 'note', v_row.review_note));
  return v_row;
end $$;

-- ── 4. Ban / unban ──────────────────────────────────────────────────────────
create or replace function public.admin_set_user_ban(p_user_id uuid, p_banned boolean, p_reason text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot ban your own account'; end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if v_target.role = 'admin' then raise exception 'Admin accounts cannot be banned here'; end if;

  update public.profiles
     set is_banned = p_banned,
         banned_at = case when p_banned then now() else null end,
         ban_reason = case when p_banned then nullif(left(btrim(coalesce(p_reason, '')), 500), '') else null end,
         updated_at = now()
   where id = p_user_id
  returning * into v_target;

  insert into public.admin_user_log (admin_id, target_user_id, action, detail)
  values (auth.uid(), p_user_id, case when p_banned then 'ban' else 'unban' end, jsonb_build_object('reason', v_target.ban_reason));
  return v_target;
end $$;

-- ── 5. Directory (joins auth.users for e-mail) ──────────────────────────────
-- Return type changes in 014: drop first so this file can be re-run after 014 (else 42P13).
drop function if exists public.admin_list_users(text, text, text, integer, integer);
create or replace function public.admin_list_users(
  p_query text default null, p_role text default null, p_status text default null,
  p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, full_name text, company_name text, email text, role public.user_role, country_code char(2),
  kyc_verified boolean, is_banned boolean, ban_reason text, created_at timestamptz, last_sign_in_at timestamptz,
  pending_change boolean, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  return query
  with base as (
    select p.id, p.full_name, p.company_name, u.email::text as email, p.role, p.country_code, p.kyc_verified,
           p.is_banned, p.ban_reason, p.created_at, u.last_sign_in_at,
           exists (select 1 from public.profile_change_requests r where r.user_id = p.id and r.status = 'pending') as pending_change
      from public.profiles p
      left join auth.users u on u.id = p.id
     where (v_q is null
            or p.full_name ilike '%' || v_q || '%'
            or p.company_name ilike '%' || v_q || '%'
            or u.email ilike '%' || v_q || '%')
       and (p_role is null or p_role = '' or p.role::text = p_role)
  ), filtered as (
    select * from base b
     where p_status is null or p_status = ''
        or (p_status = 'active' and not b.is_banned)
        or (p_status = 'banned' and b.is_banned)
        or (p_status = 'pending_edit' and b.pending_change)
  )
  select f.*, count(*) over () as total_count
    from filtered f
   order by f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- What would stop a hard delete (history we must keep). Empty object = safe to delete.
create or replace function public.admin_user_deletion_blockers(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '{}'::jsonb; n integer;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then return jsonb_build_object('self', 1); end if;
  if exists (select 1 from public.profiles where id = p_user_id and role = 'admin') then return jsonb_build_object('admin', 1); end if;
  select count(*) into n from public.orders where buyer_id = p_user_id;        if n > 0 then v := v || jsonb_build_object('orders', n); end if;
  select count(*) into n from public.products where supplier_id = p_user_id;   if n > 0 then v := v || jsonb_build_object('products', n); end if;
  select count(*) into n from public.pool_members where buyer_id = p_user_id;  if n > 0 then v := v || jsonb_build_object('pool_pledges', n); end if;
  select count(*) into n from public.payouts where supplier_id = p_user_id;    if n > 0 then v := v || jsonb_build_object('payouts', n); end if;
  return v;
end $$;

revoke all on function public.admin_list_users(text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_set_user_ban(uuid, boolean, text) from public, anon;
revoke all on function public.admin_review_profile_change(uuid, boolean, text) from public, anon;
revoke all on function public.admin_user_deletion_blockers(uuid) from public, anon;
revoke all on function public.submit_profile_change(text, text, text) from public, anon;
revoke all on function public.cancel_profile_change() from public, anon;
grant execute on function public.admin_list_users(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_set_user_ban(uuid, boolean, text) to authenticated;
grant execute on function public.admin_review_profile_change(uuid, boolean, text) to authenticated;
grant execute on function public.admin_user_deletion_blockers(uuid) to authenticated;
grant execute on function public.submit_profile_change(text, text, text) to authenticated;
grant execute on function public.cancel_profile_change() to authenticated;
