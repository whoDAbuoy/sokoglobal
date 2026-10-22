-- =============================================================================
-- SokoGlobal — Migration 020: KYC OCR, unpaid-order expiry, notification queue,
-- restored upload limits. Run after 019. Re-runnable.
--
--  * kyc_verifications gains OCR results (written by the server with the service
--    role after each upload; see lib/kyc-ocr-server.ts). OCR is advisory: it
--    never approves or rejects anything, it gives reviewers a pre-check.
--  * expire_stale_unpaid_orders(): orders still in pending_payment after 24 h are
--    cancelled and stamped expired_at (fulfillment_status becomes 'void'). Orders
--    with a payment attempt still in flight are skipped; a payment that lands after
--    expiry is already parked for review + refund by apply_card_payment /
--    apply_mpesa_payment. Scheduled hourly with pg_cron when available, plus the
--    daily /api/cron/expire-orders route. There is no stock reservation in this
--    schema (listings are made to order), so nothing needs releasing.
--  * notification_queue: one row per channel per event. Triggers on order status
--    and KYC changes enqueue rows according to the recipient's preferences
--    (email_notifications, sms_alerts + phone_number, order_status_updates);
--    /api/cron/dispatch-notifications and in-request dispatch send them.
--  * Storage caps restored: avatars 5 MB, KYC documents 10 MB, product media 500 MB.
-- =============================================================================

-- ── 1. OCR results ──────────────────────────────────────────────────────────
alter table public.kyc_verifications add column if not exists ocr_status text not null default 'pending'
  check (ocr_status in ('pending', 'completed', 'failed', 'skipped'));
alter table public.kyc_verifications add column if not exists ocr_extracted_data   jsonb;
alter table public.kyc_verifications add column if not exists ocr_confidence_score numeric(4, 3)
  check (ocr_confidence_score is null or ocr_confidence_score between 0 and 1);
alter table public.kyc_verifications add column if not exists ocr_checked_at timestamptz;
-- Documents submitted before OCR existed are not re-processed.
update public.kyc_verifications set ocr_status = 'skipped' where ocr_status = 'pending' and created_at < now() - interval '1 hour';

-- ── 2. Unpaid order expiry ──────────────────────────────────────────────────
alter table public.orders add column if not exists expired_at timestamptz;
create index if not exists orders_unpaid_age_idx on public.orders (created_at) where escrow_status = 'pending_payment';

create or replace function public.expire_stale_unpaid_orders(p_max_age interval default interval '24 hours', p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with stale as (
    select o.id from public.orders o
     where o.escrow_status = 'pending_payment'
       and o.created_at < now() - p_max_age
       -- A card or M-Pesa attempt started in the last hour may still complete.
       and not exists (select 1 from public.card_payments c
                        where c.status = 'initiated' and c.created_at > now() - interval '1 hour'
                          and (c.order_id = o.id or (o.checkout_group_id is not null and c.checkout_group_id = o.checkout_group_id)))
       and not exists (select 1 from public.mpesa_payments m
                        where m.status in ('initiating', 'pending') and m.created_at > now() - interval '1 hour'
                          and (m.order_id = o.id or (o.checkout_group_id is not null and m.checkout_group_id = o.checkout_group_id)))
     order by o.created_at
     limit greatest(p_limit, 1)
     for update of o skip locked
  )
  update public.orders o set escrow_status = 'cancelled', expired_at = now()
    from stale where o.id = stale.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.expire_stale_unpaid_orders(interval, integer) from public, anon, authenticated;
grant execute on function public.expire_stale_unpaid_orders(interval, integer) to service_role;

-- Hourly in the database when pg_cron can be enabled (Supabase: Database → Extensions).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%); rely on /api/cron/expire-orders', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-stale-unpaid-orders';
    perform cron.schedule('expire-stale-unpaid-orders', '15 * * * *', 'select public.expire_stale_unpaid_orders()');
  end if;
end $$;

-- ── 3. Notification queue ───────────────────────────────────────────────────
do $$ begin
  create type public.notification_channel as enum ('email', 'sms', 'whatsapp');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  channel       public.notification_channel not null,
  recipient     text not null check (char_length(recipient) between 3 and 320),
  template_key  text not null check (template_key ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload       jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  status        public.notification_status not null default 'pending',
  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text,
  provider_ref  text,
  dedupe_key    text not null,
  send_after    timestamptz not null default now(),
  locked_until  timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint notification_queue_dedupe unique (dedupe_key, channel)
);
create index if not exists notification_queue_due_idx on public.notification_queue (send_after) where status = 'pending';
create index if not exists notification_queue_user_idx on public.notification_queue (user_id, created_at desc);
drop trigger if exists notification_queue_touch on public.notification_queue;
create trigger notification_queue_touch before update on public.notification_queue for each row execute function public.touch_updated_at();

alter table public.notification_queue enable row level security;
drop policy if exists "notification_queue: own read" on public.notification_queue;
create policy "notification_queue: own read" on public.notification_queue for select to authenticated using (user_id = (select auth.uid()));
-- Only the service role (dispatcher) and the security-definer functions below write.
revoke all on public.notification_queue from anon, authenticated;
grant select on public.notification_queue to authenticated;

/**
 * Queues one notification per enabled channel. Preference routing:
 *   email → profiles.email_notifications and an auth email address
 *   sms   → profiles.sms_alerts and profiles.phone_number (E.164)
 *   order.* / supplier.order_* templates also need profiles.order_status_updates.
 * WhatsApp has no preference yet, so nothing is queued for it. Idempotent per dedupe key.
 */
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

-- Order events: every escrow status change notifies the buyer; funding also notifies the supplier.
create or replace function public.notify_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_supplier uuid; v_payload jsonb; v_key text;
begin
  if new.escrow_status is not distinct from old.escrow_status or new.escrow_status = 'pending_payment' then return new; end if;
  select p.title, p.supplier_id into v_title, v_supplier from public.products p where p.id = new.product_id;
  v_key := case when new.escrow_status = 'cancelled' and new.expired_at is not null then 'expired' else new.escrow_status::text end;
  v_payload := jsonb_build_object('order_id', new.id, 'product_title', coalesce(v_title, 'your order'),
    'total_cents', new.total_cents, 'currency', new.currency, 'status', new.escrow_status);
  begin
    perform public.enqueue_notification(new.buyer_id, 'order.' || v_key, v_payload, 'order:' || new.id || ':' || v_key);
    if new.escrow_status = 'funded' and v_supplier is not null then
      perform public.enqueue_notification(v_supplier, 'supplier.order_funded', v_payload, 'supplier:' || new.id || ':funded');
    end if;
  exception when others then
    raise warning 'notify_order_status failed for %: %', new.id, sqlerrm;   -- never block a payment on a notification
  end;
  return new;
end $$;
drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status after update of escrow_status on public.orders
  for each row execute function public.notify_order_status();

-- Account KYC outcome.
create or replace function public.notify_kyc_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kyc_status is not distinct from old.kyc_status or new.kyc_status not in ('approved', 'rejected') then return new; end if;
  begin
    perform public.enqueue_notification(new.id, 'kyc.' || new.kyc_status::text,
      jsonb_build_object('role', new.role), 'kyc:' || new.id || ':' || new.kyc_status::text || ':' || extract(epoch from now())::bigint);
  exception when others then
    raise warning 'notify_kyc_status failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists profiles_notify_kyc on public.profiles;
create trigger profiles_notify_kyc after update of kyc_status on public.profiles
  for each row execute function public.notify_kyc_status();

-- A single rejected document (with the reviewer's note) while the account stays unverified.
create or replace function public.notify_kyc_document()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    begin
      perform public.enqueue_notification(new.user_id, 'kyc.document_rejected',
        jsonb_build_object('document_type', new.document_type, 'reason', new.rejection_reason), 'kycdoc:' || new.id || ':rejected');
    exception when others then
      raise warning 'notify_kyc_document failed for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists kyc_verifications_notify on public.kyc_verifications;
create trigger kyc_verifications_notify after update of status on public.kyc_verifications
  for each row execute function public.notify_kyc_document();

-- Dispatcher: claim due rows on the channels it can deliver (SKIP LOCKED + a 5-minute lease, so
-- overlapping runs never double-send). Rows on unconfigured channels simply wait.
drop function if exists public.claim_notifications(integer);
create or replace function public.claim_notifications(p_channels public.notification_channel[], p_limit integer default 50)
returns setof public.notification_queue language sql security definer set search_path = public as $$
  update public.notification_queue q
     set locked_until = now() + interval '5 minutes', attempts = q.attempts + 1
   where q.id in (
     select id from public.notification_queue
      where status = 'pending' and channel = any (p_channels) and send_after <= now() and (locked_until is null or locked_until < now())
      order by send_after
      limit least(greatest(p_limit, 1), 200)
      for update skip locked)
  returning q.*
$$;

-- Success → sent. Failure → retried with exponential backoff (2, 4, 8, 16 min); permanent or 5th failure → failed.
create or replace function public.finish_notification(p_id uuid, p_success boolean, p_provider_ref text default null,
  p_error text default null, p_permanent boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notification_queue
     set status = case when p_success then 'sent'::public.notification_status
                       when p_permanent or attempts >= 5 then 'failed'::public.notification_status
                       else 'pending'::public.notification_status end,
         sent_at = case when p_success then now() end,
         provider_ref = coalesce(p_provider_ref, provider_ref),
         last_error = case when p_success then null else left(p_error, 1000) end,
         send_after = case when p_success then send_after else now() + make_interval(mins => power(2, least(attempts, 6))::integer) end,
         locked_until = null
   where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.claim_notifications(public.notification_channel[], integer)', 'public.finish_notification(uuid, boolean, text, text, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 4. Upload limits (019 removed them) ─────────────────────────────────────
update storage.buckets set file_size_limit = 5242880   where id = 'avatars';         -- 5 MB
update storage.buckets set file_size_limit = 10485760  where id = 'kyc-documents';   -- 10 MB
update storage.buckets set file_size_limit = 524288000 where id = 'product-media';   -- 500 MB
