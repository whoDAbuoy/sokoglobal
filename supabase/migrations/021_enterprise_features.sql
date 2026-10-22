-- =============================================================================
-- SokoGlobal — Migration 021: RFQs, multi-currency display rates, supplier
-- shipments, milestone escrow and restock reminders. Run after 020. Re-runnable.
--
--  * Escrow stays in USD cents (schema.sql). KES is the display base: every
--    exchange_rates row says how many KES one unit of that currency is worth,
--    and RFQ prices are entered in KES. Paystack / M-Pesa charges are still
--    computed in Postgres from the USD amount due (begin_card_payment,
--    begin_mpesa_payment), so nothing the browser shows can change a charge.
--  * RFQs: an importer posts a volume request (rfqs); suppliers whose live
--    listings sit in the requested category send one private quote each
--    (rfq_quotes, against one of their listings). accept_rfq_quote() turns a
--    quote into a locked 'standard' order priced from the quote, converted to
--    USD at the current exchange_rates USD rate (frozen on the order).
--  * Milestone escrow (payment_structure = 'milestone_30_70'): the buyer pays a
--    30% deposit (order → 'deposit_paid'), the supplier dispatches, then the
--    70% balance becomes payable; paying it moves the order to the escrow state
--    that matches the shipment. Release, payouts and force-release still need
--    the full amount ('deposit_paid' is not a releasable state).
--    'credit_30_days' is reserved in the schema; no flow offers it yet.
--  * shipments: one per order, written by the supplier's "Fulfil & ship" form
--    (supplier_save_shipment) and mirrored onto orders.current_status through
--    set_shipment_tracking(), so the escrow timeline and the map stay in sync.
--  * queue_restock_reminders(): daily; buyers whose order completed 30 or 60
--    days ago get a reminder through notification_queue (migration 020).
--
-- The new 'deposit_paid' enum value is only referenced as text or inside
-- PL/pgSQL bodies below, so this file can run in one transaction.
-- =============================================================================

-- ── 0. Escrow state for a paid deposit ──────────────────────────────────────
alter type public.escrow_status add value if not exists 'deposit_paid' after 'pending_payment';

-- ── 1. Exchange rates (display only) ────────────────────────────────────────
create table if not exists public.exchange_rates (
  currency_code char(3) primary key check (currency_code ~ '^[A-Z]{3}$'),
  rate_to_kes   numeric(18, 8) not null check (rate_to_kes > 0),   -- KES per 1 unit of currency_code
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  constraint exchange_rates_kes_is_base check (currency_code <> 'KES' or rate_to_kes = 1)
);

-- Starting values; super admins keep them current with super_set_exchange_rate().
insert into public.exchange_rates (currency_code, rate_to_kes) values
  ('KES', 1), ('USD', 129.25), ('UGX', 0.0351), ('TZS', 0.0513), ('RWF', 0.0935)
on conflict (currency_code) do nothing;

alter table public.exchange_rates enable row level security;
drop policy if exists "exchange_rates: everyone reads" on public.exchange_rates;
create policy "exchange_rates: everyone reads" on public.exchange_rates for select to anon, authenticated using (true);
revoke insert, update, delete on public.exchange_rates from anon, authenticated;
grant select on public.exchange_rates to anon, authenticated;

create or replace function public.super_set_exchange_rate(p_currency text, p_rate_to_kes numeric, p_ip text default null, p_ua text default null)
returns public.exchange_rates language plpgsql security definer set search_path = public as $$
declare v public.exchange_rates; v_old numeric; v_code text := upper(btrim(coalesce(p_currency, '')));
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter ISO code'; end if;
  if v_code = 'KES' then raise exception 'KES is the base currency (always 1)'; end if;
  if p_rate_to_kes is null or p_rate_to_kes <= 0 or p_rate_to_kes > 100000 then raise exception 'Rate must be between 0 and 100,000 KES'; end if;
  select rate_to_kes into v_old from public.exchange_rates where currency_code = v_code for update;
  insert into public.exchange_rates (currency_code, rate_to_kes, updated_at, updated_by) values (v_code, p_rate_to_kes, now(), auth.uid())
  on conflict (currency_code) do update set rate_to_kes = excluded.rate_to_kes, updated_at = now(), updated_by = auth.uid()
  returning * into v;
  perform public.write_admin_audit('fx.rate', 'exchange_rate', v_code, jsonb_build_object('from', v_old, 'to', p_rate_to_kes), p_ip, p_ua);
  return v;
end $$;

-- KES per USD, used to price RFQ orders. Raises when the rate is missing.
create or replace function public.usd_rate_to_kes()
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  select rate_to_kes into v from public.exchange_rates where currency_code = 'USD';
  if v is null or v < 1 then raise exception 'The USD exchange rate is not configured'; end if;
  return v;
end $$;

-- ── 2. Payment structure on orders ──────────────────────────────────────────
-- deposit_amount / remaining_balance are USD cents, like every other money column.
alter table public.orders add column if not exists payment_structure text not null default 'full';
alter table public.orders add column if not exists deposit_amount    integer;
alter table public.orders add column if not exists remaining_balance integer;
alter table public.orders add column if not exists deposit_paid_at   timestamptz;
alter table public.orders add column if not exists final_paid_at     timestamptz;
alter table public.orders add column if not exists fx_rate_to_kes    numeric(18, 8);   -- KES per USD used to price an RFQ order

do $$ begin
  alter table public.orders add constraint orders_payment_structure_valid
    check (payment_structure in ('full', 'milestone_30_70', 'credit_30_days'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders add constraint orders_milestone_amounts check (
    payment_structure <> 'milestone_30_70'
    or (deposit_amount > 0 and remaining_balance >= 0 and deposit_amount + remaining_balance = goods_cents + freight_cents + customs_cents));
exception when duplicate_object then null; end $$;
do $$ begin
  -- A cart is paid in one charge, so its orders are always paid in full.
  alter table public.orders add constraint orders_cart_pays_full check (checkout_group_id is null or payment_structure = 'full');
exception when duplicate_object then null; end $$;

-- Platform rules (mirrored in lib/milestone.ts).
create or replace function public.milestone_min_cents()
returns integer language sql immutable as $$ select 100000 $$;   -- $1,000.00

create or replace function public.milestone_deposit_cents(p_total integer)
returns integer language sql immutable as $$ select ((p_total::bigint * 30 + 99) / 100)::integer $$;   -- 30%, rounded up to the cent

-- Keeps the split in step with the price; the structure is fixed once money moves.
create or replace function public.orders_payment_split()
returns trigger language plpgsql as $$
declare v_total integer := new.goods_cents + new.freight_cents + new.customs_cents;
begin
  if tg_op = 'UPDATE' and new.payment_structure is distinct from old.payment_structure and old.escrow_status::text <> 'pending_payment' then
    raise exception 'The payment structure is locked once payment has started';
  end if;
  if new.payment_structure = 'milestone_30_70' then
    if new.deposit_paid_at is null then new.deposit_amount := public.milestone_deposit_cents(v_total); end if;
    new.remaining_balance := v_total - new.deposit_amount;
  else
    new.deposit_amount := null;
    new.remaining_balance := null;
  end if;
  return new;
end $$;
drop trigger if exists orders_payment_split on public.orders;
create trigger orders_payment_split before insert or update of payment_structure, goods_cents, freight_cents, customs_cents on public.orders
  for each row execute function public.orders_payment_split();

-- USD cents the buyer owes right now (0 when nothing is payable).
create or replace function public.order_amount_due_cents(p public.orders)
returns integer language sql stable as $$
  select case
    when p.escrow_status::text = 'pending_payment' then
      case when p.payment_structure = 'milestone_30_70' then p.deposit_amount else p.total_cents end
    when p.escrow_status::text = 'deposit_paid' and p.final_paid_at is null then p.remaining_balance
    else 0 end
$$;

-- USD cents actually collected for an order (refund cap).
create or replace function public.order_paid_cents(p public.orders)
returns integer language sql stable as $$
  select case
    when p.funded_at is null and p.deposit_paid_at is null then 0
    when p.payment_structure = 'milestone_30_70' and p.final_paid_at is null then coalesce(p.deposit_amount, 0)
    else p.total_cents end
$$;

-- Escrow state an order moves to when its balance lands, from where the shipment is.
create or replace function public.milestone_settled_status(p_current public.shipment_status)
returns public.escrow_status language plpgsql immutable as $$
begin
  return case p_current
    when 'in_transit'       then 'in_transit'
    when 'arrived'          then 'in_transit'
    when 'customs_cleared'  then 'customs_cleared'
    when 'out_for_delivery' then 'customs_cleared'
    when 'delivered'        then 'delivered_pending_verification'
    else 'funded'
  end::public.escrow_status;
end $$;

-- Who may choose milestone escrow: a KYC-approved buyer on an order of at least $1,000.
create or replace function public.milestone_eligible(p public.orders)
returns boolean language sql stable security definer set search_path = public as $$
  select p.checkout_group_id is null and p.order_type <> 'pool'
     and (p.goods_cents + p.freight_cents + p.customs_cents) >= public.milestone_min_cents()
     and public.kyc_approved(p.buyer_id)
$$;

-- Buyer picks full payment or milestone escrow before paying. RFQ orders are locked.
create or replace function public.set_order_payment_structure(p_order_id uuid, p_structure text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where id = p_order_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v.escrow_status::text <> 'pending_payment' then raise exception 'The payment structure is locked once payment has started'; end if;
  if v.rfq_quote_id is not null then raise exception 'Payment terms of a quoted order are fixed by the accepted quote'; end if;
  if p_structure not in ('full', 'milestone_30_70') then raise exception 'This payment option is not available'; end if;
  if p_structure = v.payment_structure then return v; end if;
  if p_structure = 'milestone_30_70' and not public.milestone_eligible(v) then
    raise exception 'Milestone escrow needs a verified business and an order of at least $%', to_char(public.milestone_min_cents() / 100.0, 'FM999G990');
  end if;
  -- A charge already in flight was priced for the current structure.
  if exists (select 1 from public.card_payments where order_id = p_order_id and status = 'initiated' and created_at > now() - interval '1 hour')
     or exists (select 1 from public.mpesa_payments where order_id = p_order_id and status in ('initiating', 'pending') and created_at > now() - interval '1 hour') then
    raise exception 'A payment for this order is still in progress. Finish or cancel it first, then try again in an hour.';
  end if;
  update public.orders set payment_structure = p_structure where id = p_order_id returning * into v;
  return v;
end $$;

-- Which leg a charge pays (null = the whole order / cart / pledge).
alter table public.card_payments  add column if not exists leg text;
alter table public.mpesa_payments add column if not exists leg text;
do $$ begin
  alter table public.card_payments  add constraint card_payments_leg_valid  check (leg is null or leg in ('deposit', 'balance'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.mpesa_payments add constraint mpesa_payments_leg_valid check (leg is null or leg in ('deposit', 'balance'));
exception when duplicate_object then null; end $$;

-- ── 3. RFQs ─────────────────────────────────────────────────────────────────
create table if not exists public.rfqs (
  id                uuid primary key default gen_random_uuid(),
  buyer_id          uuid not null references public.profiles (id) on delete cascade,
  category_id       uuid references public.categories (id) on delete set null,
  product_id        uuid references public.products (id) on delete set null,   -- optional: started from a listing
  title             text not null check (char_length(title) between 3 and 140),
  description       text not null check (char_length(description) between 10 and 4000),
  target_price_kes  numeric(14, 2) check (target_price_kes is null or target_price_kes > 0),   -- per unit
  quantity          integer not null check (quantity between 1 and 100000000),
  unit_of_measure   text check (unit_of_measure is null or char_length(unit_of_measure) between 1 and 24),
  delivery_location text not null check (char_length(delivery_location) between 2 and 160),
  status            text not null default 'open' check (status in ('open', 'quoted', 'accepted', 'rejected', 'expired')),
  accepted_quote_id uuid,
  order_id          uuid references public.orders (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '14 days',
  constraint rfqs_expiry_after_creation check (expires_at > created_at)
);
create index if not exists rfqs_buyer_idx on public.rfqs (buyer_id, created_at desc);
create index if not exists rfqs_open_idx on public.rfqs (category_id, expires_at) where status in ('open', 'quoted');
drop trigger if exists rfqs_touch on public.rfqs;
create trigger rfqs_touch before update on public.rfqs for each row execute function public.touch_updated_at();

-- Tiers: [{ "min_qty": 500, "unit_price_kes": 410.5 }], at most 5, distinct quantities.
create or replace function public.rfq_price_tiers_valid(p jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where case when jsonb_typeof(e) <> 'object'
                     or jsonb_typeof(e -> 'min_qty') is distinct from 'number'
                     or jsonb_typeof(e -> 'unit_price_kes') is distinct from 'number' then true
                   else (e ->> 'min_qty')::numeric < 1 or (e ->> 'min_qty')::numeric <> trunc((e ->> 'min_qty')::numeric)
                     or (e ->> 'min_qty')::numeric > 100000000
                     or (e ->> 'unit_price_kes')::numeric <= 0 or (e ->> 'unit_price_kes')::numeric > 10000000000 end)
     and (select count(distinct (e ->> 'min_qty')) from jsonb_array_elements(p) e) = jsonb_array_length(p)
$$;

create table if not exists public.rfq_quotes (
  id                         uuid primary key default gen_random_uuid(),
  rfq_id                     uuid not null references public.rfqs (id) on delete cascade,
  supplier_id                uuid not null references public.profiles (id) on delete cascade,
  product_id                 uuid not null references public.products (id) on delete cascade,
  unit_price_kes             numeric(14, 2) not null check (unit_price_kes > 0 and unit_price_kes <= 10000000000),
  price_tiers                jsonb not null default '[]'::jsonb check (public.rfq_price_tiers_valid(price_tiers)),
  moq                        integer not null check (moq between 1 and 100000000),
  lead_time_days             integer check (lead_time_days is null or lead_time_days between 1 and 365),
  valid_until                timestamptz not null,
  terms_note                 text check (terms_note is null or char_length(terms_note) <= 2000),
  allowed_payment_structures text[] not null default array['full', 'milestone_30_70']
    check (cardinality(allowed_payment_structures) between 1 and 3
           and allowed_payment_structures <@ array['full', 'milestone_30_70', 'credit_30_days']),
  status                     text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint rfq_quotes_one_per_supplier unique (rfq_id, supplier_id)
);
create index if not exists rfq_quotes_supplier_idx on public.rfq_quotes (supplier_id, created_at desc);
create index if not exists rfq_quotes_product_idx on public.rfq_quotes (product_id);
drop trigger if exists rfq_quotes_touch on public.rfq_quotes;
create trigger rfq_quotes_touch before update on public.rfq_quotes for each row execute function public.touch_updated_at();

do $$ begin
  alter table public.rfqs add constraint rfqs_accepted_quote_fk foreign key (accepted_quote_id) references public.rfq_quotes (id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists rfq_quote_id uuid references public.rfq_quotes (id) on delete restrict;
create unique index if not exists orders_rfq_quote_uniq on public.orders (rfq_quote_id) where rfq_quote_id is not null;

-- Category match: the listing's category is the requested one or sits below it.
create or replace function public.category_within(p_category uuid, p_ancestor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 1 as depth from public.categories where id = p_category
    union all
    select c.id, c.parent_id, up.depth + 1 from public.categories c join up on c.id = up.parent_id where up.depth < 6
  )
  select p_ancestor is null or exists (select 1 from up where id = p_ancestor)
$$;

-- RLS helpers (SECURITY DEFINER, so rfqs ↔ rfq_quotes policies never recurse).
create or replace function public.rfq_matches_supplier(p_category uuid, p_supplier uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.products p
                  where p.supplier_id = p_supplier and p.status = 'live'
                    and (p_category is null or public.category_within(p.category_id, p_category)))
$$;
create or replace function public.is_rfq_buyer(p_rfq uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rfqs where id = p_rfq and buyer_id = auth.uid())
$$;
create or replace function public.has_quoted_rfq(p_rfq uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rfq_quotes where rfq_id = p_rfq and supplier_id = auth.uid())
$$;

alter table public.rfqs enable row level security;
alter table public.rfq_quotes enable row level security;
drop policy if exists "rfqs: buyer reads own"             on public.rfqs;
drop policy if exists "rfqs: matching suppliers read open" on public.rfqs;
drop policy if exists "rfqs: quoting supplier reads"      on public.rfqs;
drop policy if exists "rfqs: admin reads"                 on public.rfqs;
create policy "rfqs: buyer reads own" on public.rfqs for select to authenticated using (buyer_id = (select auth.uid()));
create policy "rfqs: matching suppliers read open" on public.rfqs for select to authenticated using (
  status in ('open', 'quoted') and expires_at > now()
  and (select public.current_role_is('supplier')) and public.rfq_matches_supplier(category_id, (select auth.uid())));
create policy "rfqs: quoting supplier reads" on public.rfqs for select to authenticated using (public.has_quoted_rfq(id));
create policy "rfqs: admin reads" on public.rfqs for select to authenticated using ((select public.current_role_is('admin')));

drop policy if exists "rfq_quotes: supplier reads own"   on public.rfq_quotes;
drop policy if exists "rfq_quotes: buyer reads received" on public.rfq_quotes;
drop policy if exists "rfq_quotes: admin reads"          on public.rfq_quotes;
create policy "rfq_quotes: supplier reads own" on public.rfq_quotes for select to authenticated using (supplier_id = (select auth.uid()));
create policy "rfq_quotes: buyer reads received" on public.rfq_quotes for select to authenticated using (public.is_rfq_buyer(rfq_id));
create policy "rfq_quotes: admin reads" on public.rfq_quotes for select to authenticated using ((select public.current_role_is('admin')));

-- Every write goes through the functions below.
revoke insert, update, delete on public.rfqs, public.rfq_quotes from anon, authenticated;
grant select on public.rfqs, public.rfq_quotes to authenticated;

-- Effective unit price for a quantity: the highest tier the quantity reaches, else the base price.
create or replace function public.rfq_unit_price_kes(p_base numeric, p_tiers jsonb, p_qty integer)
returns numeric language sql immutable as $$
  select coalesce((select (e ->> 'unit_price_kes')::numeric from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) e
                    where (e ->> 'min_qty')::numeric <= p_qty order by (e ->> 'min_qty')::numeric desc limit 1), p_base)
$$;

create or replace function public.submit_rfq(
  p_title text, p_description text, p_quantity integer, p_delivery_location text,
  p_target_price_kes numeric default null, p_category_id uuid default null, p_product_id uuid default null,
  p_unit_of_measure text default null, p_expires_in_days integer default 14
) returns public.rfqs language plpgsql security definer set search_path = public as $$
declare v public.rfqs;
begin
  if not public.current_role_is('importer') then raise exception 'Only importer accounts can request quotes' using errcode = '42501'; end if;
  if public.kyc_required_for('orders') and not public.kyc_approved(auth.uid()) then
    raise exception 'Complete identity verification (KYC) before requesting quotes' using errcode = '42501';
  end if;
  if p_expires_in_days is null or p_expires_in_days not between 1 and 60 then raise exception 'Quotes can be collected for 1 to 60 days'; end if;
  if (select count(*) from public.rfqs where buyer_id = auth.uid() and status in ('open', 'quoted') and expires_at > now()) >= 20 then
    raise exception 'You have 20 open requests. Close or accept one before posting another.';
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id = p_category_id and is_active) then
    raise exception 'Choose an active category';
  end if;
  if p_product_id is not null and not exists (select 1 from public.products where id = p_product_id and status = 'live') then
    raise exception 'That listing is no longer available';
  end if;
  insert into public.rfqs (buyer_id, category_id, product_id, title, description, target_price_kes, quantity, unit_of_measure, delivery_location, expires_at)
  values (auth.uid(), coalesce(p_category_id, (select category_id from public.products where id = p_product_id)), p_product_id,
          btrim(p_title), btrim(p_description), p_target_price_kes, p_quantity, nullif(btrim(coalesce(p_unit_of_measure, '')), ''),
          btrim(p_delivery_location), now() + make_interval(days => p_expires_in_days))
  returning * into v;
  return v;
end $$;

-- Supplier sends (or revises) their private quote, priced against one of their live listings.
create or replace function public.submit_rfq_quote(
  p_rfq_id uuid, p_product_id uuid, p_unit_price_kes numeric, p_moq integer, p_valid_until timestamptz,
  p_terms_note text default null, p_price_tiers jsonb default '[]'::jsonb,
  p_allowed_structures text[] default array['full', 'milestone_30_70'], p_lead_time_days integer default null
) returns public.rfq_quotes language plpgsql security definer set search_path = public as $$
declare v_rfq public.rfqs; v_product public.products; v_quote public.rfq_quotes; v_existing public.rfq_quotes;
begin
  if not public.current_role_is('supplier') then raise exception 'Only supplier accounts can quote' using errcode = '42501'; end if;
  if public.kyc_required_for('listings') and not public.kyc_approved(auth.uid()) then
    raise exception 'Complete business verification (KYC) before quoting' using errcode = '42501';
  end if;
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  if not found or v_rfq.status not in ('open', 'quoted') or v_rfq.expires_at <= now() then
    raise exception 'This request is no longer accepting quotes';
  end if;
  if v_rfq.buyer_id = auth.uid() then raise exception 'You cannot quote on your own request'; end if;
  select * into v_product from public.products where id = p_product_id and supplier_id = auth.uid() and status = 'live';
  if not found then raise exception 'Quote against one of your live listings'; end if;
  if not public.category_within(v_product.category_id, v_rfq.category_id) then
    raise exception 'That listing is not in the requested category';
  end if;
  if p_valid_until is null or p_valid_until < now() + interval '1 hour' or p_valid_until > now() + interval '90 days' then
    raise exception 'A quote must stay valid for between 1 hour and 90 days';
  end if;
  if p_allowed_structures is null or 'credit_30_days' = any (p_allowed_structures) then
    raise exception 'Trade credit terms are not available yet';
  end if;

  select * into v_existing from public.rfq_quotes where rfq_id = p_rfq_id and supplier_id = auth.uid() for update;
  if found and v_existing.status = 'accepted' then raise exception 'Your quote was already accepted'; end if;

  insert into public.rfq_quotes (rfq_id, supplier_id, product_id, unit_price_kes, price_tiers, moq, lead_time_days, valid_until, terms_note, allowed_payment_structures)
  values (p_rfq_id, auth.uid(), p_product_id, p_unit_price_kes, coalesce(p_price_tiers, '[]'::jsonb), p_moq, p_lead_time_days, p_valid_until,
          nullif(btrim(coalesce(p_terms_note, '')), ''), p_allowed_structures)
  on conflict (rfq_id, supplier_id) do update
    set product_id = excluded.product_id, unit_price_kes = excluded.unit_price_kes, price_tiers = excluded.price_tiers,
        moq = excluded.moq, lead_time_days = excluded.lead_time_days, valid_until = excluded.valid_until,
        terms_note = excluded.terms_note, allowed_payment_structures = excluded.allowed_payment_structures, status = 'pending'
  returning * into v_quote;

  update public.rfqs set status = 'quoted' where id = p_rfq_id and status = 'open';
  begin
    perform public.enqueue_notification(v_rfq.buyer_id, 'rfq.quote_received',
      jsonb_build_object('rfq_id', v_rfq.id, 'rfq_title', v_rfq.title, 'unit_price_kes', v_quote.unit_price_kes),
      'rfqquote:' || v_quote.id || ':' || extract(epoch from date_trunc('hour', now()))::bigint);
  exception when others then
    raise warning 'rfq quote notification failed for %: %', v_quote.id, sqlerrm;
  end;
  return v_quote;
end $$;

-- Supplier withdraws a quote that has not been accepted.
create or replace function public.withdraw_rfq_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.rfq_quotes;
begin
  delete from public.rfq_quotes where id = p_quote_id and supplier_id = auth.uid() and status <> 'accepted' returning * into v;
  if not found then raise exception 'Quote not found, or already accepted'; end if;
  update public.rfqs r set status = 'open'
   where r.id = v.rfq_id and r.status = 'quoted'
     and not exists (select 1 from public.rfq_quotes q where q.rfq_id = r.id and q.status = 'pending');
end $$;

-- Buyer declines one quote.
create or replace function public.reject_rfq_quote(p_quote_id uuid)
returns public.rfq_quotes language plpgsql security definer set search_path = public as $$
declare v public.rfq_quotes;
begin
  update public.rfq_quotes q set status = 'rejected'
   where q.id = p_quote_id and q.status = 'pending'
     and exists (select 1 from public.rfqs r where r.id = q.rfq_id and r.buyer_id = auth.uid() and r.status in ('open', 'quoted'))
  returning * into v;
  if not found then raise exception 'Quote is not awaiting your decision'; end if;
  update public.rfqs r set status = 'open'
   where r.id = v.rfq_id and r.status = 'quoted'
     and not exists (select 1 from public.rfq_quotes q where q.rfq_id = r.id and q.status = 'pending');
  return v;
end $$;

-- Buyer closes a request without accepting (pending quotes are declined).
create or replace function public.close_rfq(p_rfq_id uuid)
returns public.rfqs language plpgsql security definer set search_path = public as $$
declare v public.rfqs;
begin
  update public.rfqs set status = 'rejected' where id = p_rfq_id and buyer_id = auth.uid() and status in ('open', 'quoted') returning * into v;
  if not found then raise exception 'Request is not open'; end if;
  update public.rfq_quotes set status = 'rejected' where rfq_id = p_rfq_id and status = 'pending';
  return v;
end $$;

-- Buyer accepts a quote → one locked escrow order (pay it from the order page).
create or replace function public.accept_rfq_quote(p_quote_id uuid, p_payment_structure text default 'milestone_30_70')
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_quote   public.rfq_quotes;
  v_rfq     public.rfqs;
  v_product public.products;
  v_order   public.orders;
  v_qty     integer;
  v_unit    numeric;
  v_rate    numeric := public.usd_rate_to_kes();
  v_goods   numeric;
begin
  if not public.current_role_is('importer') then raise exception 'Only importer accounts can accept quotes' using errcode = '42501'; end if;
  select * into v_quote from public.rfq_quotes where id = p_quote_id;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  select * into v_rfq from public.rfqs where id = v_quote.rfq_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if v_rfq.status not in ('open', 'quoted') then raise exception 'This request is already %', v_rfq.status; end if;
  if v_rfq.expires_at <= now() then raise exception 'This request has expired'; end if;
  select * into v_quote from public.rfq_quotes where id = p_quote_id for update;
  if v_quote.status <> 'pending' then raise exception 'This quote is no longer open'; end if;
  if v_quote.valid_until <= now() then raise exception 'This quote has expired — ask the supplier to re-quote'; end if;
  if p_payment_structure = 'credit_30_days' then raise exception 'Trade credit terms are not available yet'; end if;
  if p_payment_structure is null or not (p_payment_structure = any (v_quote.allowed_payment_structures)) then
    raise exception 'The supplier did not offer that payment option';
  end if;
  select * into v_product from public.products where id = v_quote.product_id and supplier_id = v_quote.supplier_id and status = 'live';
  if not found then raise exception 'The quoted listing is no longer available'; end if;

  v_qty   := greatest(v_rfq.quantity, v_quote.moq);
  v_unit  := public.rfq_unit_price_kes(v_quote.unit_price_kes, v_quote.price_tiers, v_qty);
  v_goods := round(v_unit * v_qty * 100 / v_rate);
  if v_goods < 1 or v_goods > 2000000000 then raise exception 'This quote is outside the escrow limits ($0.01 – $20,000,000)'; end if;

  insert into public.orders (buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents,
                             payment_structure, rfq_quote_id, fx_rate_to_kes, destination_label)
  values (auth.uid(), v_product.id, 'standard', v_qty, v_goods::integer, 0, 0,
          p_payment_structure, v_quote.id, v_rate, left(v_rfq.delivery_location, 80))
  returning * into v_order;
  if p_payment_structure = 'milestone_30_70' and not public.milestone_eligible(v_order) then
    raise exception 'Milestone escrow needs a verified business and an order of at least $%', to_char(public.milestone_min_cents() / 100.0, 'FM999G990');
  end if;

  update public.rfq_quotes set status = case when id = v_quote.id then 'accepted' else 'rejected' end
   where rfq_id = v_rfq.id and (id = v_quote.id or status = 'pending');
  update public.rfqs set status = 'accepted', accepted_quote_id = v_quote.id, order_id = v_order.id where id = v_rfq.id;
  begin
    perform public.enqueue_notification(v_quote.supplier_id, 'supplier.rfq_accepted',
      jsonb_build_object('rfq_id', v_rfq.id, 'rfq_title', v_rfq.title, 'order_id', v_order.id, 'product_title', v_product.title,
                         'total_cents', v_order.total_cents, 'currency', v_order.currency, 'payment_structure', p_payment_structure),
      'rfqaccepted:' || v_quote.id);
  exception when others then
    raise warning 'rfq accepted notification failed for %: %', v_quote.id, sqlerrm;
  end;
  return v_order;
end $$;

-- Open requests past their deadline → expired; their pending quotes are declined.
create or replace function public.expire_stale_rfqs(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with stale as (
    select id from public.rfqs where status in ('open', 'quoted') and expires_at <= now()
     order by expires_at limit greatest(p_limit, 1) for update skip locked
  ), closed as (
    update public.rfqs r set status = 'expired' from stale where r.id = stale.id returning r.id
  ), declined as (
    update public.rfq_quotes q set status = 'rejected' from closed where q.rfq_id = closed.id and q.status = 'pending' returning q.id
  )
  select count(*) into v_count from closed;
  return v_count;
end $$;

-- Supplier lane: open requests matching the caller's live listings, with what the supplier may know about the buyer.
create or replace function public.supplier_rfq_feed()
returns table (
  id uuid, title text, description text, quantity integer, unit_of_measure text, target_price_kes numeric,
  delivery_location text, category_id uuid, category_name text, buyer_country char(2), status text,
  created_at timestamptz, expires_at timestamptz, quote_count integer, my_quote jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.description, r.quantity, r.unit_of_measure, r.target_price_kes, r.delivery_location, r.category_id,
         c.name, b.country_code, r.status, r.created_at, r.expires_at,
         (select count(*)::integer from public.rfq_quotes q where q.rfq_id = r.id),
         (select to_jsonb(q) - 'supplier_id' from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid())
    from public.rfqs r
    join public.profiles b on b.id = r.buyer_id
    left join public.categories c on c.id = r.category_id
   where public.current_role_is('supplier') and r.buyer_id <> auth.uid()
     and ((r.status in ('open', 'quoted') and r.expires_at > now() and public.rfq_matches_supplier(r.category_id, auth.uid()))
          or exists (select 1 from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid()))
   order by (r.status in ('open', 'quoted') and r.expires_at > now()) desc, r.created_at desc
   limit 200
$$;

-- ── 4. Shipments ────────────────────────────────────────────────────────────
create table if not exists public.shipments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  supplier_id        uuid references public.profiles (id) on delete set null,
  carrier_name       text not null check (char_length(carrier_name) between 2 and 80),
  tracking_number    text not null check (char_length(tracking_number) between 3 and 80 and tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]*$'),
  tracking_url       text check (tracking_url is null or (tracking_url ~ '^https://[^\s]+$' and char_length(tracking_url) <= 500)),
  status             text not null default 'label_created' check (status in ('label_created', 'in_transit', 'out_for_delivery', 'delivered')),
  estimated_delivery timestamptz,
  dispatched_at      timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists shipments_order_uniq on public.shipments (order_id);
create index if not exists shipments_supplier_idx on public.shipments (supplier_id, created_at desc);
drop trigger if exists shipments_touch on public.shipments;
create trigger shipments_touch before update on public.shipments for each row execute function public.touch_updated_at();

create or replace function public.is_order_supplier(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o join public.products p on p.id = o.product_id
                  where o.id = p_order and p.supplier_id = auth.uid())
$$;

alter table public.shipments enable row level security;
drop policy if exists "shipments: buyer reads own"     on public.shipments;
drop policy if exists "shipments: supplier reads own"  on public.shipments;
drop policy if exists "shipments: admin reads"         on public.shipments;
create policy "shipments: buyer reads own" on public.shipments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())));
create policy "shipments: supplier reads own" on public.shipments for select to authenticated using (public.is_order_supplier(order_id));
create policy "shipments: admin reads" on public.shipments for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.shipments from anon, authenticated;
grant select on public.shipments to authenticated;

-- Supplier "Fulfil & ship": record the waybill and move the shipment forward (never back).
-- The order's tracking (and, for fully paid orders, its escrow state) follows via set_shipment_tracking().
create or replace function public.supplier_save_shipment(
  p_order_id uuid, p_carrier text, p_tracking_number text, p_tracking_url text default null,
  p_estimated_delivery timestamptz default null, p_status text default 'in_transit'
) returns public.shipments language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_existing public.shipments;
  v_ship     public.shipments;
  v_rank     constant text[] := array['label_created', 'in_transit', 'out_for_delivery', 'delivered'];
  v_track    public.shipment_status;
begin
  if not public.current_role_is('supplier') or not public.is_order_supplier(p_order_id) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.escrow_status::text not in ('funded', 'deposit_paid', 'in_transit', 'customs_cleared') then
    raise exception 'Only paid orders that are not yet delivered can be shipped (this one is %)', replace(v_order.escrow_status::text, '_', ' ');
  end if;
  if p_status is null or not (p_status = any (v_rank)) then raise exception 'Unknown shipment status'; end if;
  select * into v_existing from public.shipments where order_id = p_order_id for update;
  if found and array_position(v_rank, p_status) < array_position(v_rank, v_existing.status) then
    raise exception 'A shipment cannot move back from % to %', replace(v_existing.status, '_', ' '), replace(p_status, '_', ' ');
  end if;
  if p_status = 'in_transit' and v_existing.dispatched_at is null and p_estimated_delivery is not null and p_estimated_delivery <= now() then
    raise exception 'The estimated delivery must be in the future';
  end if;

  insert into public.shipments (order_id, supplier_id, carrier_name, tracking_number, tracking_url, status, estimated_delivery, dispatched_at, delivered_at)
  values (p_order_id, auth.uid(), btrim(p_carrier), btrim(p_tracking_number), nullif(btrim(coalesce(p_tracking_url, '')), ''), p_status, p_estimated_delivery,
          case when p_status <> 'label_created' then now() end, case when p_status = 'delivered' then now() end)
  on conflict (order_id) do update
    set carrier_name = excluded.carrier_name, tracking_number = excluded.tracking_number, tracking_url = excluded.tracking_url,
        status = excluded.status, estimated_delivery = coalesce(excluded.estimated_delivery, shipments.estimated_delivery),
        dispatched_at = coalesce(shipments.dispatched_at, excluded.dispatched_at),
        delivered_at = coalesce(shipments.delivered_at, excluded.delivered_at)
  returning * into v_ship;

  update public.orders set tracking_number = v_ship.tracking_number, carrier = v_ship.carrier_name where id = p_order_id;

  v_track := case v_ship.status
    when 'in_transit' then 'in_transit' when 'out_for_delivery' then 'out_for_delivery' when 'delivered' then 'delivered'
    else 'awaiting_dispatch' end::public.shipment_status;
  -- shipment_status is ordered, so ops updates (e.g. customs cleared) are never rolled back.
  if v_track > v_order.current_status then
    perform public.set_shipment_tracking(p_order_id, v_track,
      case when v_order.discharge_timestamp is null then v_ship.dispatched_at end,
      case when v_ship.estimated_delivery > coalesce(v_order.discharge_timestamp, v_ship.dispatched_at, now()) then v_ship.estimated_delivery end,
      null, null, null, null, null);
  end if;

  -- Milestone orders: dispatch makes the 70% balance payable.
  if v_order.escrow_status::text = 'deposit_paid' and v_ship.status <> 'label_created' then
    begin
      perform public.enqueue_notification(v_order.buyer_id, 'order.balance_due',
        jsonb_build_object('order_id', v_order.id, 'product_title', (select title from public.products where id = v_order.product_id),
                           'total_cents', v_order.remaining_balance, 'currency', v_order.currency,
                           'carrier', v_ship.carrier_name, 'tracking_number', v_ship.tracking_number),
        'order:' || v_order.id || ':balance_due');
    exception when others then
      raise warning 'balance_due notification failed for %: %', v_order.id, sqlerrm;
    end;
  end if;
  return v_ship;
end $$;

-- ── 5. Payments: milestone legs ─────────────────────────────────────────────
-- begin_payment_attempt: same as 008, but an order's amount is what is due now
-- (full total, 30% deposit, or — once dispatched — the 70% balance).
create or replace function public.begin_payment_attempt(p_kind text, p_ref_id uuid, p_buyer_id uuid)
returns table (o_tx_ref text, o_amount_cents integer, o_currency text)
language plpgsql security definer set search_path = public as $$
declare v_attempt integer; v_amount integer; v_currency text; v_count integer; v_order public.orders;
begin
  if p_kind = 'order' then
    if exists (select 1 from public.orders where id = p_ref_id and checkout_group_id is not null) then
      raise exception 'This order is part of a cart checkout — pay it from the checkout page';
    end if;
    select * into v_order from public.orders where id = p_ref_id and buyer_id = p_buyer_id;
    if found and v_order.escrow_status::text = 'deposit_paid' and v_order.final_paid_at is null and v_order.current_status = 'awaiting_dispatch' then
      raise exception 'The 70%% balance becomes payable once the supplier dispatches your order';
    end if;
    update public.orders o
       set payment_attempts = o.payment_attempts + 1
     where o.id = p_ref_id and o.buyer_id = p_buyer_id
       and (o.escrow_status::text = 'pending_payment'
            or (o.escrow_status::text = 'deposit_paid' and o.final_paid_at is null and o.current_status <> 'awaiting_dispatch'))
    returning * into v_order;
    if not found then raise exception 'Order is not awaiting payment'; end if;
    v_attempt := v_order.payment_attempts;
    v_amount := public.order_amount_due_cents(v_order);
    v_currency := v_order.currency;
    o_tx_ref := 'ord_' || p_ref_id;

  elsif p_kind = 'pool' then
    update public.pool_members m
       set payment_attempts = m.payment_attempts + 1
      from public.trend_pools p
     where m.pool_id = p_ref_id and m.buyer_id = p_buyer_id and m.payment_status = 'pending_payment'
       and p.id = m.pool_id and p.status in ('open', 'funded') and p.deadline > now()
    returning m.payment_attempts, m.contribution_cents into v_attempt, v_amount;
    if not found then raise exception 'This pledge is not awaiting payment'; end if;
    v_currency := 'USD';
    o_tx_ref := 'pool_' || p_ref_id || '_' || p_buyer_id;

  elsif p_kind = 'group' then
    update public.checkout_groups g
       set payment_attempts = g.payment_attempts + 1
     where g.id = p_ref_id and g.buyer_id = p_buyer_id
    returning g.payment_attempts into v_attempt;
    if not found then raise exception 'Checkout not found'; end if;
    update public.orders set payment_attempts = payment_attempts + 1
     where checkout_group_id = p_ref_id and escrow_status = 'pending_payment';
    select coalesce(sum(total_cents), 0), count(*) into v_amount, v_count
      from public.orders where checkout_group_id = p_ref_id and escrow_status = 'pending_payment';
    if v_count = 0 then raise exception 'Nothing left to pay in this checkout'; end if;
    v_currency := 'USD';
    o_tx_ref := 'grp_' || p_ref_id;

  else
    raise exception 'Unknown payment kind %', p_kind;
  end if;

  if v_amount is null or v_amount <= 0 then raise exception 'Nothing is due on this order right now'; end if;
  if v_attempt > 1 then o_tx_ref := o_tx_ref || '-' || v_attempt; end if;
  o_amount_cents := v_amount;
  o_currency := v_currency;
  return next;
end $$;

-- begin_card_payment: same as 011, plus which leg of a milestone order the charge pays.
create or replace function public.begin_card_payment(
  p_kind text, p_ref_id uuid, p_buyer_id uuid, p_currency text, p_usd_rate numeric
) returns public.card_payments language plpgsql security definer set search_path = public as $$
declare
  v_attempt  record;
  v_currency text := upper(coalesce(p_currency, 'USD'));
  v_rate     numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_usd_rate end;
  v_leg      text;
  v_payment  public.card_payments;
begin
  if v_rate is null or v_rate <= 0 then raise exception 'Card payment exchange rate is not configured correctly'; end if;
  select * into v_attempt from public.begin_payment_attempt(p_kind, p_ref_id, p_buyer_id);
  if v_attempt.o_currency <> 'USD' then raise exception 'Unsupported escrow currency %', v_attempt.o_currency; end if;
  if p_kind = 'order' then
    select case when o.escrow_status::text = 'deposit_paid' then 'balance'
                when o.payment_structure = 'milestone_30_70' then 'deposit' end
      into v_leg from public.orders o where o.id = p_ref_id;
  end if;

  insert into public.card_payments (reference, kind, order_id, checkout_group_id, pool_id, buyer_id,
                                    usd_cents, currency, usd_rate, amount_minor, leg)
  values (replace(v_attempt.o_tx_ref, '_', '.'), p_kind,
          case when p_kind = 'order' then p_ref_id end,
          case when p_kind = 'group' then p_ref_id end,
          case when p_kind = 'pool'  then p_ref_id end,
          p_buyer_id, v_attempt.o_amount_cents, v_currency, v_rate,
          case when v_currency = 'USD' then v_attempt.o_amount_cents else ceil(v_attempt.o_amount_cents * v_rate)::bigint end,
          v_leg)
  returning * into v_payment;
  return v_payment;
end $$;

-- apply_card_payment: same as 011; the order branch also settles milestone deposits and balances.
create or replace function public.apply_card_payment(
  p_reference text, p_provider_ref text, p_amount_minor bigint, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay     public.card_payments;
  v_order   public.orders;
  v_member  public.pool_members;
  v_pool    public.trend_pools;
  v_due     integer;
  v_why     text;
  v_outcome text;
begin
  select * into v_pay from public.card_payments where reference = p_reference for update;
  if not found then return 'unknown_reference'; end if;
  if v_pay.status <> 'initiated' then return 'already_processed'; end if;

  if upper(p_currency) <> v_pay.currency then v_why := format('Charged in %s, expected %s', upper(p_currency), v_pay.currency);
  elsif p_amount_minor < v_pay.amount_minor then v_why := format('Charged %s, expected %s (%s minor units)', p_amount_minor, v_pay.amount_minor, v_pay.currency);
  end if;
  if v_why is not null then
    update public.card_payments set status = 'review', provider_ref = p_provider_ref, review_reason = v_why, completed_at = now() where id = v_pay.id;
    return case when upper(p_currency) <> v_pay.currency then 'currency_mismatch' else 'amount_mismatch' end;
  end if;

  if v_pay.kind = 'order' then
    select * into v_order from public.orders where id = v_pay.order_id for update;
    if v_order.escrow_status::text = 'pending_payment' and v_pay.leg is null and v_order.payment_structure = 'full' then
      update public.orders set escrow_status = 'funded', payment_provider = 'paystack', payment_ref = p_provider_ref, funded_at = now()
       where id = v_order.id;
      v_outcome := 'order_funded';
    elsif v_order.escrow_status::text = 'pending_payment' and v_pay.leg = 'deposit' and v_order.payment_structure = 'milestone_30_70' then
      if v_pay.usd_cents <> v_order.deposit_amount then
        v_why := format('Deposit due was %s USD cents but this card payment was for %s — reconcile or refund the buyer', v_order.deposit_amount, v_pay.usd_cents);
      else
        update public.orders set escrow_status = 'deposit_paid', deposit_paid_at = now(), funded_at = now(),
               payment_provider = 'paystack', payment_ref = p_provider_ref
         where id = v_order.id;
        v_outcome := 'deposit_funded';
      end if;
    elsif v_order.escrow_status::text = 'deposit_paid' and v_pay.leg = 'balance' and v_order.final_paid_at is null then
      if v_pay.usd_cents <> v_order.remaining_balance then
        v_why := format('Balance due was %s USD cents but this card payment was for %s — reconcile or refund the buyer', v_order.remaining_balance, v_pay.usd_cents);
      else
        update public.orders set escrow_status = public.milestone_settled_status(current_status), final_paid_at = now(),
               delivered_at = case when current_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
         where id = v_order.id;
        v_outcome := 'balance_funded';
      end if;
    else
      v_why := format('Order was already %s when this card payment (%s) completed — refund the buyer', v_order.escrow_status, coalesce(v_pay.leg, 'full amount'));
    end if;

  elsif v_pay.kind = 'group' then
    perform 1 from public.checkout_groups where id = v_pay.checkout_group_id for update;
    perform 1 from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment' for update;
    select coalesce(sum(total_cents), 0) into v_due
      from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
    if v_due <> v_pay.usd_cents then
      v_why := format('Checkout had %s USD cents unpaid when this card payment (for %s) completed — reconcile or refund the buyer', v_due, v_pay.usd_cents);
    else
      update public.orders
         set escrow_status = 'funded', payment_provider = 'paystack', payment_ref = p_provider_ref || ':' || id, funded_at = now()
       where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
      update public.checkout_groups set payment_provider = 'paystack', payment_ref = p_provider_ref, funded_at = now()
       where id = v_pay.checkout_group_id;
      v_outcome := 'group_funded';
    end if;

  else -- pool pledge
    select * into v_member from public.pool_members where pool_id = v_pay.pool_id and buyer_id = v_pay.buyer_id for update;
    if not found or v_member.payment_status not in ('pending_payment', 'cancelled') then
      v_why := 'Pledge was already paid (or missing) when this card payment completed — refund the buyer';
    else
      select * into v_pool from public.trend_pools where id = v_pay.pool_id;
      update public.pool_members
         set payment_status = 'funded', payment_ref = p_provider_ref, payment_provider = 'paystack', paid_at = now(),
             refund_status = case when v_pool.status in ('expired', 'cancelled') then 'pending' else refund_status end
       where pool_id = v_pay.pool_id and buyer_id = v_pay.buyer_id;
      v_outcome := case when v_pool.status in ('expired', 'cancelled') then 'pledge_funded_refund_queued' else 'pledge_funded' end;
    end if;
  end if;

  if v_why is not null then
    update public.card_payments set status = 'review', provider_ref = p_provider_ref, review_reason = v_why, completed_at = now() where id = v_pay.id;
    return 'duplicate_payment';
  end if;
  update public.card_payments set status = 'succeeded', provider_ref = p_provider_ref, completed_at = now() where id = v_pay.id;
  return v_outcome;
end $$;

-- begin_mpesa_payment: same as 007, but for the amount due now (full, deposit or balance).
create or replace function public.begin_mpesa_payment(
  p_order_id uuid, p_buyer_id uuid, p_phone text, p_kes_per_usd numeric, p_max_kes integer
) returns public.mpesa_payments language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_due      integer;
  v_leg      text;
  v_kes      integer;
  v_payment  public.mpesa_payments;
begin
  if p_kes_per_usd is null or p_kes_per_usd < 50 or p_kes_per_usd > 500 then
    raise exception 'M-Pesa exchange rate is not configured correctly';
  end if;

  select * into v_order from public.orders where id = p_order_id and buyer_id = p_buyer_id;
  if found and v_order.escrow_status::text = 'deposit_paid' and v_order.final_paid_at is null and v_order.current_status = 'awaiting_dispatch' then
    raise exception 'The 70%% balance becomes payable once the supplier dispatches your order';
  end if;
  -- Locks the order row, so concurrent attempts for one order run one at a time.
  update public.orders o
     set payment_attempts = o.payment_attempts + 1
   where o.id = p_order_id and o.buyer_id = p_buyer_id
     and (o.escrow_status::text = 'pending_payment'
          or (o.escrow_status::text = 'deposit_paid' and o.final_paid_at is null and o.current_status <> 'awaiting_dispatch'))
  returning * into v_order;
  if not found then raise exception 'Order is not awaiting payment'; end if;
  if v_order.currency <> 'USD' then raise exception 'Unsupported order currency %', v_order.currency; end if;
  v_due := public.order_amount_due_cents(v_order);
  if v_due is null or v_due <= 0 then raise exception 'Nothing is due on this order right now'; end if;
  v_leg := case when v_order.escrow_status::text = 'deposit_paid' then 'balance'
                when v_order.payment_structure = 'milestone_30_70' then 'deposit' end;

  -- One live prompt per order: a second push while the first is still on the
  -- buyer's phone could charge them twice. Prompts expire after ~1 minute.
  if exists (select 1 from public.mpesa_payments
              where order_id = p_order_id and status in ('initiating', 'pending')
                and created_at > now() - interval '2 minutes') then
    raise exception 'An M-Pesa prompt was already sent for this order. Check your phone, or try again in 2 minutes.';
  end if;

  v_kes := ceil(v_due * p_kes_per_usd / 100.0)::integer;
  if v_kes > p_max_kes then
    raise exception 'This payment is KES % — above the M-Pesa limit of KES % per transaction. Please pay by card.',
      to_char(v_kes, 'FM999,999,990'), to_char(p_max_kes, 'FM999,999,990');
  end if;

  insert into public.mpesa_payments (order_id, buyer_id, phone, usd_cents, kes_per_usd, amount_kes, leg)
  values (p_order_id, p_buyer_id, p_phone, v_due, p_kes_per_usd, v_kes, v_leg)
  returning * into v_payment;
  return v_payment;
end $$;

-- apply_mpesa_payment: same as 008; the order branch also settles milestone deposits and balances.
create or replace function public.apply_mpesa_payment(
  p_checkout_request_id text, p_result_code integer, p_result_desc text, p_receipt text, p_amount_kes integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay     public.mpesa_payments;
  v_order   public.orders;
  v_due     integer;
  v_ref     text;
  v_why     text;
  v_outcome text;
begin
  select * into v_pay from public.mpesa_payments where checkout_request_id = p_checkout_request_id for update;
  if not found then return 'unknown_reference'; end if;

  if v_pay.status not in ('initiating', 'pending') then
    -- Settled from STK Query before the callback brought the receipt: fill it in.
    if v_pay.status = 'succeeded' and v_pay.mpesa_receipt is null and p_receipt is not null then
      update public.mpesa_payments set mpesa_receipt = p_receipt where id = v_pay.id;
      if v_pay.checkout_group_id is null then
        update public.orders set payment_ref = p_receipt
         where id = v_pay.order_id and payment_ref = 'mpesa:' || p_checkout_request_id;
      else
        update public.orders set payment_ref = p_receipt || ':' || id
         where checkout_group_id = v_pay.checkout_group_id and payment_ref = 'mpesa:' || p_checkout_request_id || ':' || id;
        update public.checkout_groups set payment_ref = p_receipt
         where id = v_pay.checkout_group_id and payment_ref = 'mpesa:' || p_checkout_request_id;
      end if;
    end if;
    return 'already_processed';
  end if;

  if p_result_code <> 0 then
    update public.mpesa_payments
       set status = case when p_result_code = 1032 then 'cancelled' else 'failed' end,
           result_code = p_result_code, result_desc = left(p_result_desc, 500), completed_at = now()
     where id = v_pay.id;
    return 'payment_failed';
  end if;

  if p_amount_kes is not null and p_amount_kes <> v_pay.amount_kes then
    update public.mpesa_payments
       set status = 'review', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
           completed_at = now(), review_reason = format('Paid KES %s, expected KES %s', p_amount_kes, v_pay.amount_kes)
     where id = v_pay.id;
    return 'amount_mismatch';
  end if;

  v_ref := coalesce(p_receipt, 'mpesa:' || p_checkout_request_id);

  if v_pay.checkout_group_id is not null then
    perform 1 from public.checkout_groups where id = v_pay.checkout_group_id for update;
    perform 1 from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment' for update;
    select coalesce(sum(total_cents), 0) into v_due
      from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
    if v_due <> v_pay.usd_cents then
      -- Already paid (e.g. by card meanwhile) or the cart's unpaid total changed.
      update public.mpesa_payments
         set status = 'review', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
             completed_at = now(),
             review_reason = format('Checkout had %s USD cents unpaid when this M-Pesa payment (for %s) completed — reconcile or refund the buyer', v_due, v_pay.usd_cents)
       where id = v_pay.id;
      return 'duplicate_payment';
    end if;
    update public.mpesa_payments
       set status = 'succeeded', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
           completed_at = now()
     where id = v_pay.id;
    update public.orders
       set escrow_status = 'funded', payment_provider = 'mpesa', payment_ref = v_ref || ':' || id, funded_at = now()
     where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
    update public.checkout_groups
       set payment_provider = 'mpesa', payment_ref = v_ref, funded_at = now()
     where id = v_pay.checkout_group_id;
    return 'group_funded';
  end if;

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_order.escrow_status::text = 'pending_payment' and v_pay.leg is null and v_order.payment_structure = 'full' then
    update public.orders
       set escrow_status = 'funded', payment_provider = 'mpesa', payment_ref = v_ref, funded_at = now()
     where id = v_pay.order_id;
    v_outcome := 'order_funded';
  elsif v_order.escrow_status::text = 'pending_payment' and v_pay.leg = 'deposit' and v_order.payment_structure = 'milestone_30_70' then
    if v_pay.usd_cents <> v_order.deposit_amount then
      v_why := format('Deposit due was %s USD cents but this M-Pesa payment was for %s — reconcile or refund the buyer', v_order.deposit_amount, v_pay.usd_cents);
    else
      update public.orders
         set escrow_status = 'deposit_paid', deposit_paid_at = now(), funded_at = now(), payment_provider = 'mpesa', payment_ref = v_ref
       where id = v_pay.order_id;
      v_outcome := 'deposit_funded';
    end if;
  elsif v_order.escrow_status::text = 'deposit_paid' and v_pay.leg = 'balance' and v_order.final_paid_at is null then
    if v_pay.usd_cents <> v_order.remaining_balance then
      v_why := format('Balance due was %s USD cents but this M-Pesa payment was for %s — reconcile or refund the buyer', v_order.remaining_balance, v_pay.usd_cents);
    else
      update public.orders set escrow_status = public.milestone_settled_status(current_status), final_paid_at = now(),
             delivered_at = case when current_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
       where id = v_pay.order_id;
      v_outcome := 'balance_funded';
    end if;
  else
    -- Paid twice (e.g. card + M-Pesa) or the order was cancelled meanwhile.
    v_why := format('Order was already %s when this M-Pesa payment (%s) completed — refund the buyer', v_order.escrow_status, coalesce(v_pay.leg, 'full amount'));
  end if;

  if v_why is not null then
    update public.mpesa_payments
       set status = 'review', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
           completed_at = now(), review_reason = v_why
     where id = v_pay.id;
    return 'duplicate_payment';
  end if;
  update public.mpesa_payments
     set status = 'succeeded', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
         completed_at = now()
   where id = v_pay.id;
  return v_outcome;
end $$;

-- Disputes may also freeze a paid deposit.
create or replace function public.open_dispute(p_order_id uuid, p_reason text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  update public.orders
     set escrow_status = 'disputed', dispute_reason = left(p_reason, 2000)
   where id = p_order_id
     and buyer_id = auth.uid()
     and escrow_status::text in ('funded', 'deposit_paid', 'in_transit', 'customs_cleared', 'delivered_pending_verification')
  returning * into v_order;
  if not found then raise exception 'Order cannot be disputed in its current state'; end if;
  return v_order;
end $$;

-- Refunds (014) also cover a held deposit, and never exceed what was actually collected.
create or replace function public.super_record_refund(p_order_id uuid, p_amount_cents integer, p_full boolean, p_provider text, p_provider_ref text,
  p_status text, p_reason text, p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders; v_reason text := public.require_super_reason(p_reason); v_paid integer;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v.escrow_status::text not in ('funded', 'deposit_paid', 'in_transit', 'customs_cleared', 'delivered_pending_verification', 'disputed') then
    raise exception 'Refunds are only possible while funds are held in escrow (order is %)', v.escrow_status;
  end if;
  v_paid := public.order_paid_cents(v);
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > v_paid then
    raise exception 'Refund amount must be between 1 cent and the % cents collected for this order', v_paid;
  end if;
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

-- ── 6. Notifications ────────────────────────────────────────────────────────
-- Same as 020, plus: deposits notify the supplier, a paid balance notifies the
-- supplier, and payloads carry the carrier + waybill once an order has shipped.
create or replace function public.notify_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_supplier uuid; v_payload jsonb; v_key text;
begin
  if new.escrow_status is not distinct from old.escrow_status or new.escrow_status::text = 'pending_payment' then return new; end if;
  select p.title, p.supplier_id into v_title, v_supplier from public.products p where p.id = new.product_id;
  v_key := case when new.escrow_status::text = 'cancelled' and new.expired_at is not null then 'expired' else new.escrow_status::text end;
  v_payload := jsonb_strip_nulls(jsonb_build_object('order_id', new.id, 'product_title', coalesce(v_title, 'your order'),
    'total_cents', new.total_cents, 'currency', new.currency, 'status', new.escrow_status,
    'payment_structure', new.payment_structure, 'deposit_cents', new.deposit_amount, 'balance_cents', new.remaining_balance,
    'carrier', new.carrier, 'tracking_number', new.tracking_number));
  begin
    perform public.enqueue_notification(new.buyer_id, 'order.' || v_key, v_payload, 'order:' || new.id || ':' || v_key);
    if v_supplier is not null then
      if new.escrow_status::text = 'funded' and old.escrow_status::text = 'pending_payment' then
        perform public.enqueue_notification(v_supplier, 'supplier.order_funded', v_payload, 'supplier:' || new.id || ':funded');
      elsif new.escrow_status::text = 'deposit_paid' then
        perform public.enqueue_notification(v_supplier, 'supplier.order_deposit', v_payload, 'supplier:' || new.id || ':deposit');
      elsif old.escrow_status::text = 'deposit_paid' and new.final_paid_at is not null then
        perform public.enqueue_notification(v_supplier, 'supplier.order_balance_paid', v_payload, 'supplier:' || new.id || ':balance');
      end if;
    end if;
  exception when others then
    raise warning 'notify_order_status failed for %: %', new.id, sqlerrm;   -- never block a payment on a notification
  end;
  return new;
end $$;

-- ── 7. Supplier catalogue: deposit-paid orders are ready to fulfil too ─────
create or replace function public.get_supplier_grouped_catalog()
returns table (
  listing_id uuid, title text, image_url text, unit_of_measure text, order_count integer, total_quantity bigint,
  total_batches bigint, total_goods_cents bigint, total_landed_cents bigint, oldest_paid_at timestamptz, orders jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.title,
         (select m.public_url from public.product_media m where m.product_id = p.id and m.media_type = 'image' order by m.sort_order, m.created_at limit 1),
         p.unit_of_measure,
         count(*)::integer, sum(o.quantity)::bigint, sum(o.batches)::bigint, sum(o.goods_cents)::bigint, sum(o.total_cents)::bigint,
         min(o.funded_at),
         jsonb_agg(jsonb_build_object(
           'order_id', o.id, 'quantity', o.quantity, 'batches', o.batches, 'goods_cents', o.goods_cents, 'paid_at', o.funded_at,
           'buyer_company', b.company_name, 'buyer_country', b.country_code,
           'destination', o.destination_label, 'eta', o.eta_timestamp, 'shipment_status', o.current_status,
           'tracking_number', o.tracking_number, 'carrier', o.carrier,
           'payment_structure', o.payment_structure, 'escrow_status', o.escrow_status,
           'is_rfq', o.rfq_quote_id is not null) order by o.funded_at)
    from public.orders o
    join public.products p on p.id = o.product_id
    join public.profiles b on b.id = o.buyer_id
   where p.supplier_id = auth.uid()
     and (o.fulfillment_status = 'pending_fulfillment'
          or (o.escrow_status::text = 'deposit_paid' and o.current_status = 'awaiting_dispatch'))
   group by p.id, p.title, p.unit_of_measure
   order by min(o.funded_at)
$$;

-- ── 8. Restock reminders ────────────────────────────────────────────────────
-- Buyers whose order completed 30 or 60 days ago (7-day catch-up window, so a
-- missed run is not lost) and who have not reordered that listing since.
-- Idempotent: one reminder per order per milestone (dedupe key).
create or replace function public.queue_restock_reminders(p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_count integer := 0;
begin
  for r in
    select o.id, o.buyer_id, o.product_id, o.batches, o.quantity, p.title, d.days
      from public.orders o
      join public.products p on p.id = o.product_id and p.status = 'live' and p.deleted_at is null
      cross join (values (30), (60)) as d(days)
     where o.escrow_status = 'released'
       and coalesce(o.released_at, o.verified_at) between now() - make_interval(days => d.days + 7) and now() - make_interval(days => d.days)
       and not exists (select 1 from public.orders n
                        where n.buyer_id = o.buyer_id and n.product_id = o.product_id and n.created_at > o.created_at
                          and n.escrow_status::text not in ('cancelled'))
       and not exists (select 1 from public.notification_queue q where q.dedupe_key = 'restock:' || o.id || ':' || d.days)
     order by o.released_at
     limit greatest(p_limit, 1)
  loop
    begin
      if public.enqueue_notification(r.buyer_id, 'retention.restock_reminder',
           jsonb_build_object('order_id', r.id, 'product_id', r.product_id, 'product_title', r.title,
                              'days', r.days, 'batches', r.batches, 'quantity', r.quantity),
           'restock:' || r.id || ':' || r.days) > 0 then
        v_count := v_count + 1;
      end if;
    exception when others then
      raise warning 'restock reminder failed for %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('queue-restock-reminders', 'expire-stale-rfqs');
    perform cron.schedule('queue-restock-reminders', '0 6 * * *', 'select public.queue_restock_reminders()');
    perform cron.schedule('expire-stale-rfqs', '40 * * * *', 'select public.expire_stale_rfqs()');
  end if;
end $$;

-- ── 9. Grants ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Signed-in callers (each function checks the caller's role and ownership itself).
  foreach f in array array[
    'public.super_set_exchange_rate(text, numeric, text, text)',
    'public.set_order_payment_structure(uuid, text)',
    'public.submit_rfq(text, text, integer, text, numeric, uuid, uuid, text, integer)',
    'public.submit_rfq_quote(uuid, uuid, numeric, integer, timestamptz, text, jsonb, text[], integer)',
    'public.withdraw_rfq_quote(uuid)', 'public.reject_rfq_quote(uuid)', 'public.close_rfq(uuid)',
    'public.accept_rfq_quote(uuid, text)', 'public.supplier_rfq_feed()',
    'public.supplier_save_shipment(uuid, text, text, text, timestamptz, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Schedulers and payment confirmation only.
  foreach f in array array['public.expire_stale_rfqs(integer)', 'public.queue_restock_reminders(integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
