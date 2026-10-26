-- =============================================================================
-- SokoGlobal — Migration 033: integration outbox for n8n and Twenty CRM. Run after 032. Re-runnable.
--
--  * public.integration_outbox: one row per (event, target). Triggers below queue platform events;
--    the bridge (/api/v1/webhooks/n8n, lib/integrations/outbox.ts) claims rows with
--    claim_integration_events() and delivers them to n8n (signed webhook) or Twenty CRM (REST).
--    Rows for a target that is not configured simply wait; purge_integration_outbox() drops
--    anything older than 30 days.
--  * public.crm_links: SokoGlobal entity → Twenty record id, so a supplier, buyer or opportunity is
--    created in the CRM once and reused.
--  * Events: rfq.created (n8n: matched suppliers get an alert; Twenty: listing-specific requests),
--    rfq.quote_submitted (Twenty), escrow.status_changed (n8n, from the escrow_events audit log),
--    lead.inquiry_created (n8n + Twenty: a buyer opened a product conversation) and
--    supplier.profile_viewed (Twenty, via record_supplier_profile_view(), once per buyer per day).
--  * Every trigger swallows its own errors (warning only): an integration must never block an
--    RFQ, a payment or a chat. Payment and escrow functions themselves are not changed.
--  * Both tables are service-role only (RLS on, no policies, no grants to anon/authenticated).
--    n8n payloads never name the buyer to the supplier (same rule as supplier_rfq_feed()).
-- =============================================================================

create table if not exists public.integration_outbox (
  id           bigint generated always as identity primary key,
  target       text not null check (target in ('n8n', 'twenty')),
  event_type   text not null check (event_type ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  dedupe_key   text not null check (char_length(dedupe_key) between 3 and 200),
  status       text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  send_after   timestamptz not null default now(),
  locked_until timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint integration_outbox_dedupe unique (dedupe_key, target)
);
create index if not exists integration_outbox_due_idx on public.integration_outbox (target, send_after) where status = 'pending';
create index if not exists integration_outbox_created_idx on public.integration_outbox (created_at);
drop trigger if exists integration_outbox_touch on public.integration_outbox;
create trigger integration_outbox_touch before update on public.integration_outbox for each row execute function public.touch_updated_at();

create table if not exists public.crm_links (
  link_key   text primary key check (char_length(link_key) between 3 and 200),
  crm_id     text not null check (char_length(crm_id) between 1 and 100),
  created_at timestamptz not null default now()
);

alter table public.integration_outbox enable row level security;
alter table public.crm_links enable row level security;
revoke all on public.integration_outbox from public, anon, authenticated;
revoke all on public.crm_links from public, anon, authenticated;
grant all on public.integration_outbox, public.crm_links to service_role;

-- Internal: queue one event for one target. Idempotent per (dedupe key, target).
create or replace function public.enqueue_integration_event(p_target text, p_type text, p_payload jsonb, p_dedupe text)
returns void language sql security definer set search_path = public as $$
  insert into public.integration_outbox (target, event_type, payload, dedupe_key)
  values (p_target, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key, target) do nothing
$$;

-- ── Triggers ────────────────────────────────────────────────────────────────

-- New RFQ: every target gets the request; only n8n's copy omits the buyer's identity.
create or replace function public.integration_rfq_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_category text; v_buyer public.profiles; v_supplier uuid; v_base jsonb;
begin
  begin
    select name into v_category from public.categories where id = new.category_id;
    select * into v_buyer from public.profiles where id = new.buyer_id;
    v_base := jsonb_strip_nulls(jsonb_build_object('rfq_id', new.id, 'title', new.title, 'description', left(new.description, 500),
      'quantity', new.quantity, 'unit_of_measure', new.unit_of_measure, 'target_price_kes', new.target_price_kes,
      'delivery_location', new.delivery_location, 'category_id', new.category_id, 'category_name', v_category,
      'product_id', new.product_id, 'buyer_country', v_buyer.country_code, 'created_at', new.created_at, 'expires_at', new.expires_at));
    perform public.enqueue_integration_event('n8n', 'rfq.created', v_base, 'rfq:' || new.id);
    -- A request started from a listing belongs to that supplier's pipeline straight away;
    -- category-wide requests reach the CRM when a supplier quotes (rfq.quote_submitted).
    if new.product_id is not null then
      select supplier_id into v_supplier from public.products where id = new.product_id;
      if v_supplier is not null then
        perform public.enqueue_integration_event('twenty', 'rfq.created', v_base || jsonb_build_object(
          'supplier_id', v_supplier, 'supplier_company', (select company_name from public.profiles where id = v_supplier),
          'buyer_id', new.buyer_id, 'buyer_name', v_buyer.full_name, 'buyer_company', v_buyer.company_name), 'rfq:' || new.id);
      end if;
    end if;
  exception when others then
    raise warning 'integration_rfq_created failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists rfqs_integration_created on public.rfqs;
create trigger rfqs_integration_created after insert on public.rfqs for each row execute function public.integration_rfq_created();

-- First quote from a supplier on an RFQ (revisions update the row and are not re-sent).
create or replace function public.integration_rfq_quote_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rfq public.rfqs; v_buyer public.profiles;
begin
  begin
    select * into v_rfq from public.rfqs where id = new.rfq_id;
    select * into v_buyer from public.profiles where id = v_rfq.buyer_id;
    perform public.enqueue_integration_event('twenty', 'rfq.quote_submitted', jsonb_strip_nulls(jsonb_build_object(
      'rfq_id', new.rfq_id, 'quote_id', new.id, 'title', v_rfq.title, 'quantity', v_rfq.quantity,
      'unit_price_kes', new.unit_price_kes, 'price_tiers', new.price_tiers, 'moq', new.moq, 'valid_until', new.valid_until,
      'supplier_id', new.supplier_id, 'supplier_company', (select company_name from public.profiles where id = new.supplier_id),
      'buyer_id', v_rfq.buyer_id, 'buyer_name', v_buyer.full_name, 'buyer_company', v_buyer.company_name,
      'buyer_country', v_buyer.country_code, 'created_at', new.created_at)), 'quote:' || new.id);
  exception when others then
    raise warning 'integration_rfq_quote_submitted failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists rfq_quotes_integration_submitted on public.rfq_quotes;
create trigger rfq_quotes_integration_submitted after insert on public.rfq_quotes for each row execute function public.integration_rfq_quote_submitted();

-- Escrow milestones, read from the append-only audit log (orders and its triggers are untouched).
-- Order creation (→ pending_payment) is not a milestone.
create or replace function public.integration_escrow_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_title text; v_supplier uuid;
begin
  if new.to_status::text = 'pending_payment' then return new; end if;
  begin
    select * into v_order from public.orders where id = new.order_id;
    select title, supplier_id into v_title, v_supplier from public.products where id = v_order.product_id;
    perform public.enqueue_integration_event('n8n', 'escrow.status_changed', jsonb_strip_nulls(jsonb_build_object(
      'order_id', new.order_id, 'from_status', new.from_status, 'to_status', new.to_status,
      'product_title', v_title, 'total_cents', v_order.total_cents, 'currency', v_order.currency,
      'payment_structure', v_order.payment_structure, 'buyer_id', v_order.buyer_id, 'supplier_id', v_supplier,
      'occurred_at', new.created_at)), 'escrow:' || new.id);
  exception when others then
    raise warning 'integration_escrow_event failed for %: %', new.order_id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists escrow_events_integration on public.escrow_events;
create trigger escrow_events_integration after insert on public.escrow_events for each row execute function public.integration_escrow_event();

-- A buyer opened a conversation about a product: a new lead for that supplier.
create or replace function public.integration_inquiry_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_buyer public.profiles; v_base jsonb;
begin
  if new.kind <> 'product' then return new; end if;
  begin
    select title into v_title from public.products where id = new.product_id;
    select * into v_buyer from public.profiles where id = new.buyer_id;
    v_base := jsonb_strip_nulls(jsonb_build_object('thread_id', new.id, 'product_id', new.product_id, 'product_title', v_title,
      'supplier_id', new.supplier_id, 'supplier_company', (select company_name from public.profiles where id = new.supplier_id),
      'buyer_company', v_buyer.company_name, 'buyer_country', v_buyer.country_code, 'created_at', new.created_at));
    perform public.enqueue_integration_event('n8n', 'lead.inquiry_created', v_base, 'inquiry:' || new.id);
    perform public.enqueue_integration_event('twenty', 'lead.inquiry_created',
      v_base || jsonb_build_object('buyer_id', new.buyer_id, 'buyer_name', v_buyer.full_name), 'inquiry:' || new.id);
  exception when others then
    raise warning 'integration_inquiry_created failed for %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists chat_threads_integration_inquiry on public.chat_threads;
create trigger chat_threads_integration_inquiry after insert on public.chat_threads for each row execute function public.integration_inquiry_created();

-- Called by the supplier profile page. Buyers only, never your own profile, once per buyer per supplier per day.
create or replace function public.record_supplier_profile_view(p_supplier_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_viewer public.profiles; v_supplier public.profiles;
begin
  if auth.uid() is null or p_supplier_id is null or p_supplier_id = auth.uid() then return; end if;
  select * into v_viewer from public.profiles where id = auth.uid();
  if not found or v_viewer.role <> 'importer' then return; end if;
  select * into v_supplier from public.profiles where id = p_supplier_id;
  if not found or v_supplier.role <> 'supplier' or coalesce(v_supplier.is_banned, false) then return; end if;
  perform public.enqueue_integration_event('twenty', 'supplier.profile_viewed', jsonb_build_object(
    'supplier_id', v_supplier.id, 'supplier_company', v_supplier.company_name,
    'buyer_id', v_viewer.id, 'buyer_name', v_viewer.full_name, 'buyer_company', v_viewer.company_name,
    'buyer_country', v_viewer.country_code, 'viewed_on', current_date),
    'profile_view:' || v_supplier.id || ':' || v_viewer.id || ':' || current_date);
end $$;

-- ── Dispatcher RPCs (service role) ──────────────────────────────────────────

-- Claim due rows for one target (SKIP LOCKED + a 5-minute lease, so overlapping runs never double-send).
create or replace function public.claim_integration_events(p_target text, p_limit integer default 50)
returns setof public.integration_outbox language sql security definer set search_path = public as $$
  update public.integration_outbox o
     set locked_until = now() + interval '5 minutes', attempts = o.attempts + 1
   where o.id in (
     select id from public.integration_outbox
      where status = 'pending' and target = p_target and send_after <= now() and (locked_until is null or locked_until < now())
      order by send_after, id
      limit least(greatest(p_limit, 1), 200)
      for update skip locked)
  returning o.*
$$;

-- sent / skipped are final. A failure retries with backoff (2, 4, 8 … 64 min); the 8th failure, or a
-- permanent one, is final.
create or replace function public.finish_integration_event(p_id bigint, p_outcome text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome not in ('sent', 'skipped', 'retry', 'failed') then raise exception 'Unknown outcome %', p_outcome; end if;
  update public.integration_outbox
     set status = case when p_outcome in ('sent', 'skipped', 'failed') then p_outcome
                       when attempts >= 8 then 'failed' else 'pending' end,
         sent_at = case when p_outcome = 'sent' then now() end,
         last_error = case when p_outcome in ('retry', 'failed') then left(p_error, 1000) else null end,
         send_after = case when p_outcome = 'retry' then now() + make_interval(mins => power(2, least(attempts, 6))::integer) else send_after end,
         locked_until = null
   where id = p_id;
end $$;

create or replace function public.purge_integration_outbox(p_days integer default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from public.integration_outbox where created_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Suppliers to alert about an RFQ: the same match as supplier_rfq_feed() (a live listing in the
-- requested category or below it), excluding banned accounts and the buyer. Contact details are
-- the supplier's own; the opt-in flags let the n8n workflow respect their preferences.
create or replace function public.rfq_supplier_recipients(p_rfq_id uuid, p_limit integer default 200)
returns table (supplier_id uuid, company_name text, country_code char(2), phone_number text, email text,
               email_notifications boolean, sms_alerts boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.company_name, s.country_code, s.phone_number, u.email, s.email_notifications, s.sms_alerts
    from public.rfqs r
    join public.profiles s on s.role = 'supplier' and s.id <> r.buyer_id and not coalesce(s.is_banned, false)
    left join auth.users u on u.id = s.id
   where r.id = p_rfq_id
     and exists (select 1 from public.products p
                  where p.supplier_id = s.id and p.status = 'live'
                    and (r.category_id is null or public.category_within(p.category_id, r.category_id)))
   order by s.id
   limit least(greatest(p_limit, 1), 500)
$$;

-- Contact details for the parties of an event (escrow / inquiry alerts), each party's own.
create or replace function public.integration_contacts(p_ids uuid[])
returns table (id uuid, role public.user_role, company_name text, country_code char(2), phone_number text, email text,
               email_notifications boolean, sms_alerts boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, p.company_name, p.country_code, p.phone_number, u.email, p.email_notifications, p.sms_alerts
    from public.profiles p left join auth.users u on u.id = p.id
   where p.id = any (p_ids) and not coalesce(p.is_banned, false)
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.enqueue_integration_event(text, text, jsonb, text)',
    'public.integration_rfq_created()', 'public.integration_rfq_quote_submitted()',
    'public.integration_escrow_event()', 'public.integration_inquiry_created()',
    'public.claim_integration_events(text, integer)', 'public.finish_integration_event(bigint, text, text)',
    'public.purge_integration_outbox(integer)', 'public.rfq_supplier_recipients(uuid, integer)',
    'public.integration_contacts(uuid[])'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.record_supplier_profile_view(uuid) from public, anon;
grant execute on function public.record_supplier_profile_view(uuid) to authenticated;
