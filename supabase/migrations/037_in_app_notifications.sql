-- =============================================================================
-- SokoGlobal — Migration 037: in-app notifications (the header bell). Run after 036. Re-runnable.
--
--  * public.user_notifications: one row per event per user (order status, deposits, quotes, KYC,
--    support replies…), written by enqueue_notification() for EVERY event, whatever the user's
--    email / SMS preferences. Before this the only record was notification_queue, which holds rows
--    only for the email / SMS channels a user has switched on, so someone with email off had nothing.
--  * enqueue_notification() is otherwise unchanged (same signature, grants and email / SMS routing);
--    the in-app insert has its own exception block, so it can never stop an email, an SMS or the
--    payment / order change that triggered it.
--  * Users read their own rows (RLS) and mark them read with mark_notifications_read(); nothing else
--    is writable. Live updates via Supabase Realtime.
--  * Backfill: past events from notification_queue are copied in as already read, so nobody starts
--    with a wall of stale unread items.
-- =============================================================================

create table if not exists public.user_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  dedupe_key   text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint user_notifications_dedupe unique (user_id, dedupe_key)
);
create index if not exists user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
create index if not exists user_notifications_unread_idx on public.user_notifications (user_id) where read_at is null;

alter table public.user_notifications enable row level security;
drop policy if exists "user_notifications: own read" on public.user_notifications;
create policy "user_notifications: own read" on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.user_notifications from anon, authenticated;
grant select on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

-- Same as migration 020, plus the in-app row first (before the email / SMS preference checks).
create or replace function public.enqueue_notification(p_user uuid, p_template text, p_payload jsonb, p_dedupe text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
  v_email   text;
  v_count   integer := 0;
  v_n       integer;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then return 0; end if;
  begin
    insert into public.user_notifications (user_id, template_key, payload, dedupe_key)
    values (p_user, p_template, coalesce(p_payload, '{}'::jsonb), p_dedupe)
    on conflict (user_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'in-app notification failed for %: %', p_user, sqlerrm;   -- never block email / SMS or the caller
  end;
  if (p_template like 'order.%' or p_template like 'supplier.order_%') and not coalesce(v_profile.order_status_updates, true) then
    return 0;
  end if;
  if coalesce(v_profile.email_notifications, true) then
    select email into v_email from auth.users where id = p_user;
    if v_email is not null then
      insert into public.notification_queue (user_id, channel, recipient, template_key, payload, dedupe_key)
      values (p_user, 'email', v_email, p_template, coalesce(p_payload, '{}'::jsonb), p_dedupe)
      on conflict (dedupe_key, channel) do nothing;
      get diagnostics v_n = row_count; v_count := v_count + v_n;
    end if;
  end if;
  if coalesce(v_profile.sms_alerts, false) and v_profile.phone_number is not null then
    insert into public.notification_queue (user_id, channel, recipient, template_key, payload, dedupe_key)
    values (p_user, 'sms', v_profile.phone_number, p_template, coalesce(p_payload, '{}'::jsonb), p_dedupe)
    on conflict (dedupe_key, channel) do nothing;
    get diagnostics v_n = row_count; v_count := v_count + v_n;
  end if;
  return v_count;
end $$;
revoke all on function public.enqueue_notification(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.enqueue_notification(uuid, text, jsonb, text) to service_role;

-- Mark the caller's notifications read: all of them, or just the given ids. Returns how many changed.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update public.user_notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- History so far, one row per event (email and SMS copies share a dedupe key), already read.
insert into public.user_notifications (user_id, template_key, payload, dedupe_key, created_at, read_at)
select distinct on (q.user_id, q.dedupe_key) q.user_id, q.template_key, q.payload, q.dedupe_key, q.created_at, now()
  from public.notification_queue q
 order by q.user_id, q.dedupe_key, q.created_at
on conflict (user_id, dedupe_key) do nothing;

-- Live badge updates (Supabase Realtime respects the RLS policy above).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;
