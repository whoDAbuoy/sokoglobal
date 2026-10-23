-- =============================================================================
-- SokoGlobal — Migration 026: platform monetization — pricing controls, Gold
-- Supplier subscriptions, RFQ add-ons, escrow / FX / logistics margins and
-- instant early payouts. Run after 025. Re-runnable.
--
--  * Pricing lives on the existing single-row platform_settings (migration 014,
--    the kill-switch row; id is boolean there). Everyone can read it (public
--    prices); only super_set_platform_pricing() writes it — super admins only,
--    validated and audited as 'platform.pricing'. Rates are fractions
--    (0.05 = 5%), prices USD.
--  * subscriptions: one row per user and plan. Gold Supplier is bought by card
--    for one month at a time (no auto-renewal); paying again extends the
--    period. is_gold_supplier() = active and not past current_period_end.
--    Gold suppliers get the lower commission on orders placed while Gold is
--    active, and a "Gold Supplier" badge (KYC "Verified" stays separate).
--  * Card purchases: card_payments gains kinds 'subscription' and 'rfq_addon'
--    (begin_card_purchase → Paystack → apply_card_payment), priced in Postgres
--    from platform_settings.
--  * RFQs: is_featured (pinned to the top of supplier feeds) and
--    needs_white_glove (opens a support ticket for the ops team), each set only
--    by a verified payment.
--  * Orders: escrow_fee_cents (buyer pays escrow_fee_percent of goods + freight
--    + customs, frozen per order) is now part of total_cents, so every existing
--    payment path (card, M-Pesa, carts, milestone split, refunds) charges it.
--    Pool orders and orders placed before 026 have no fee. commission_rate is
--    snapshotted per order (Gold or standard). logistics_markup_cents records
--    the markup inside freight_cents (applied when an admin approves a listing:
--    the freight they enter is the carrier cost).
--  * FX spread: card charges in a non-USD currency and M-Pesa (KES) charges
--    use the base rate × (1 + fx_spread_percent); fx_margin_cents records it.
--  * Early payout: once an order is fully paid (milestone balance included)
--    and dispatched with a waybill, its supplier can request the payout before
--    the buyer confirms delivery, for early_payout_discount_fee of the goods
--    value. SokoGlobal carries the risk (a later refund comes from platform
--    funds). Payouts record early + early_payout_fee_cents.
--  * Supplier payouts use the order's commission_rate; orders placed before 026
--    keep the PLATFORM_FEE_BPS rate passed by the app.
-- =============================================================================

-- ── 1. Pricing ──────────────────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists supplier_gold_monthly_price      numeric(10, 2) not null default 49.00,
  add column if not exists supplier_gold_commission_rate    numeric(6, 4)  not null default 0.03,
  add column if not exists default_supplier_commission_rate numeric(6, 4)  not null default 0.05,
  add column if not exists featured_rfq_price               numeric(10, 2) not null default 15.00,
  add column if not exists white_glove_sourcing_fee         numeric(10, 2) not null default 25.00,
  add column if not exists escrow_fee_percent               numeric(6, 4)  not null default 0.02,
  add column if not exists fx_spread_percent                numeric(6, 4)  not null default 0.01,
  add column if not exists early_payout_discount_fee        numeric(6, 4)  not null default 0.03,
  add column if not exists logistics_markup_percent         numeric(6, 4)  not null default 0.08,
  add column if not exists pricing_updated_at               timestamptz,
  add column if not exists pricing_updated_by               uuid references public.profiles (id) on delete set null;

do $$ begin
  alter table public.platform_settings add constraint platform_pricing_valid check (
    supplier_gold_monthly_price between 1 and 10000
    and featured_rfq_price between 1 and 10000
    and white_glove_sourcing_fee between 1 and 10000
    and default_supplier_commission_rate between 0 and 0.30
    and supplier_gold_commission_rate between 0 and default_supplier_commission_rate
    and escrow_fee_percent between 0 and 0.10
    and fx_spread_percent between 0 and 0.10
    and early_payout_discount_fee between 0 and 0.20
    and logistics_markup_percent between 0 and 1);
exception when duplicate_object then null; end $$;

create or replace function public.pricing_json(s public.platform_settings)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'supplier_gold_monthly_price', s.supplier_gold_monthly_price, 'supplier_gold_commission_rate', s.supplier_gold_commission_rate,
    'default_supplier_commission_rate', s.default_supplier_commission_rate, 'featured_rfq_price', s.featured_rfq_price,
    'white_glove_sourcing_fee', s.white_glove_sourcing_fee, 'escrow_fee_percent', s.escrow_fee_percent,
    'fx_spread_percent', s.fx_spread_percent, 'early_payout_discount_fee', s.early_payout_discount_fee,
    'logistics_markup_percent', s.logistics_markup_percent)
$$;

-- p_pricing: any subset of the nine pricing fields (numbers). Prices in USD, rates as fractions.
create or replace function public.super_set_platform_pricing(p_pricing jsonb, p_ip text default null, p_ua text default null)
returns public.platform_settings language plpgsql security definer set search_path = public as $$
declare
  v_old public.platform_settings;
  v     public.platform_settings;
  k     text;
  c_fields constant text[] := array['supplier_gold_monthly_price', 'supplier_gold_commission_rate', 'default_supplier_commission_rate',
    'featured_rfq_price', 'white_glove_sourcing_fee', 'escrow_fee_percent', 'fx_spread_percent', 'early_payout_discount_fee', 'logistics_markup_percent'];
  n jsonb;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p_pricing is null or jsonb_typeof(p_pricing) <> 'object' then raise exception 'Pricing must be a JSON object'; end if;
  for k in select jsonb_object_keys(p_pricing) loop
    if not (k = any (c_fields)) then raise exception 'Unknown pricing field %', k; end if;
    if jsonb_typeof(p_pricing -> k) <> 'number' then raise exception '% must be a number', k; end if;
  end loop;
  select * into v_old from public.platform_settings where id for update;
  if not found then raise exception 'Platform settings row is missing (run migration 014)'; end if;
  n := public.pricing_json(v_old) || p_pricing;

  -- Friendly messages first; the platform_pricing_valid constraint is the backstop.
  foreach k in array array['supplier_gold_monthly_price', 'featured_rfq_price', 'white_glove_sourcing_fee'] loop
    if (n ->> k)::numeric not between 1 and 10000 or (n ->> k)::numeric <> round((n ->> k)::numeric, 2) then
      raise exception '% must be between $1.00 and $10,000.00 (whole cents)', replace(k, '_', ' ');
    end if;
  end loop;
  foreach k in array c_fields[2:3] || c_fields[6:9] loop
    if (n ->> k)::numeric <> round((n ->> k)::numeric, 4) then raise exception '% allows at most two decimals as a percentage', replace(k, '_', ' '); end if;
  end loop;
  if (n ->> 'default_supplier_commission_rate')::numeric not between 0 and 0.30 then raise exception 'Standard commission must be between 0%% and 30%%'; end if;
  if (n ->> 'supplier_gold_commission_rate')::numeric not between 0 and (n ->> 'default_supplier_commission_rate')::numeric then
    raise exception 'Gold commission must be between 0%% and the standard commission';
  end if;
  if (n ->> 'escrow_fee_percent')::numeric not between 0 and 0.10 then raise exception 'Escrow fee must be between 0%% and 10%%'; end if;
  if (n ->> 'fx_spread_percent')::numeric not between 0 and 0.10 then raise exception 'FX spread must be between 0%% and 10%%'; end if;
  if (n ->> 'early_payout_discount_fee')::numeric not between 0 and 0.20 then raise exception 'Early payout fee must be between 0%% and 20%%'; end if;
  if (n ->> 'logistics_markup_percent')::numeric not between 0 and 1 then raise exception 'Logistics markup must be between 0%% and 100%%'; end if;

  update public.platform_settings
     set supplier_gold_monthly_price      = (n ->> 'supplier_gold_monthly_price')::numeric,
         supplier_gold_commission_rate    = (n ->> 'supplier_gold_commission_rate')::numeric,
         default_supplier_commission_rate = (n ->> 'default_supplier_commission_rate')::numeric,
         featured_rfq_price               = (n ->> 'featured_rfq_price')::numeric,
         white_glove_sourcing_fee         = (n ->> 'white_glove_sourcing_fee')::numeric,
         escrow_fee_percent               = (n ->> 'escrow_fee_percent')::numeric,
         fx_spread_percent                = (n ->> 'fx_spread_percent')::numeric,
         early_payout_discount_fee        = (n ->> 'early_payout_discount_fee')::numeric,
         logistics_markup_percent         = (n ->> 'logistics_markup_percent')::numeric,
         pricing_updated_at = now(), pricing_updated_by = auth.uid(), updated_at = now()
   where id returning * into v;
  perform public.write_admin_audit('platform.pricing', 'platform', 'pricing',
    jsonb_build_object('from', public.pricing_json(v_old), 'to', public.pricing_json(v)), p_ip, p_ua);
  return v;
end $$;

-- ── 2. Subscriptions ────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  plan_type          text not null check (plan_type in ('free', 'gold_supplier', 'enterprise_buyer')),
  status             text not null default 'active' check (status in ('active', 'canceled', 'past_due')),
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint subscriptions_one_per_plan unique (user_id, plan_type)
);
create index if not exists subscriptions_active_idx on public.subscriptions (plan_type, current_period_end) where status = 'active';
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions: owner reads" on public.subscriptions;
drop policy if exists "subscriptions: admin reads" on public.subscriptions;
create policy "subscriptions: owner reads" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "subscriptions: admin reads" on public.subscriptions for select to authenticated using ((select public.current_role_is('admin')));
-- Written only by apply_card_payment() (a verified charge) and expire_lapsed_subscriptions().
revoke insert, update, delete on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create or replace function public.is_gold_supplier(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s
                  where s.user_id = p_user and s.plan_type = 'gold_supplier' and s.status = 'active' and s.current_period_end > now())
$$;

-- Badge lookup for listings and quotes (Gold status is public, like the badge itself).
create or replace function public.gold_supplier_ids(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.user_id from public.subscriptions s
   where cardinality(p_ids) <= 1000 and s.user_id = any (p_ids)
     and s.plan_type = 'gold_supplier' and s.status = 'active' and s.current_period_end > now()
$$;

-- Daily (expire-orders cron): paid periods that ended become past_due.
create or replace function public.expire_lapsed_subscriptions()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.subscriptions set status = 'past_due' where status = 'active' and current_period_end <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 3. RFQ add-ons ──────────────────────────────────────────────────────────
alter table public.rfqs add column if not exists is_featured              boolean not null default false;
alter table public.rfqs add column if not exists needs_white_glove        boolean not null default false;
alter table public.rfqs add column if not exists featured_at              timestamptz;
alter table public.rfqs add column if not exists white_glove_requested_at timestamptz;
create index if not exists rfqs_featured_idx on public.rfqs (featured_at desc) where is_featured and status in ('open', 'quoted');

-- Supplier lane: same as 022, plus is_featured; live featured requests come first.
drop function if exists public.supplier_rfq_feed();
create function public.supplier_rfq_feed()
returns table (
  id uuid, title text, description text, quantity integer, unit_of_measure text, target_price_kes numeric,
  delivery_location text, category_id uuid, category_name text, buyer_country char(2), status text,
  created_at timestamptz, expires_at timestamptz, quote_count integer, my_quote jsonb, can_quote boolean, is_featured boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.description, r.quantity, r.unit_of_measure, r.target_price_kes, r.delivery_location, r.category_id,
         c.name, b.country_code, r.status, r.created_at, r.expires_at,
         (select count(*)::integer from public.rfq_quotes q where q.rfq_id = r.id),
         (select to_jsonb(q) - 'supplier_id' from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid()),
         public.rfq_matches_supplier(r.category_id, auth.uid()),
         r.is_featured
    from public.rfqs r
    join public.profiles b on b.id = r.buyer_id
    left join public.categories c on c.id = r.category_id
   where public.current_role_is('supplier') and r.buyer_id <> auth.uid()
     and ((r.status in ('open', 'quoted') and r.expires_at > now())
          or exists (select 1 from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid()))
   order by (r.status in ('open', 'quoted') and r.expires_at > now()) desc,
            (r.is_featured and r.status in ('open', 'quoted') and r.expires_at > now()) desc,
            public.rfq_matches_supplier(r.category_id, auth.uid()) desc, r.created_at desc
   limit 200
$$;

-- Service-role code (a paid white-glove request) may file a support message on a customer's behalf.
-- Signed-in senders are still always stamped from their session, as in 003.
create or replace function public.stamp_support_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null or new.sender_id is null then
    new.sender_id := auth.uid();
    new.sender_role := case when public.current_role_is('admin') then 'agent' else 'customer' end;
  else
    new.sender_role := 'customer';
  end if;
  return new;
end $$;

-- ── 4. Orders: escrow fee, commission snapshot, logistics markup ────────────
alter table public.orders add column if not exists escrow_fee_cents          integer not null default 0;
alter table public.orders add column if not exists escrow_fee_rate           numeric(6, 4);
alter table public.orders add column if not exists logistics_markup_cents    integer not null default 0;
alter table public.orders add column if not exists commission_rate           numeric(6, 4);
alter table public.orders add column if not exists early_payout_requested_at timestamptz;
alter table public.orders add column if not exists early_payout_fee_rate     numeric(6, 4);
do $$ begin
  alter table public.orders add constraint orders_platform_fees_valid check (
    escrow_fee_cents >= 0 and logistics_markup_cents >= 0
    and (escrow_fee_rate is null or escrow_fee_rate between 0 and 0.10)
    and (commission_rate is null or commission_rate between 0 and 0.30)
    and (early_payout_fee_rate is null or early_payout_fee_rate between 0 and 0.20));
exception when duplicate_object then null; end $$;

-- Markup applied to a listing's freight when it was approved (null = before 026).
alter table public.products add column if not exists freight_markup_percent numeric(6, 4);

-- total_cents now includes the escrow fee. A generated expression can't be altered in place on
-- Postgres 15, so the column is re-created once (its only dependant is supplier_active_orders).
do $$ begin
  if not exists (
    select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.orders'::regclass and a.attname = 'total_cents'
       and pg_get_expr(d.adbin, d.adrelid) like '%escrow_fee_cents%') then
    drop view if exists public.supplier_active_orders;
    alter table public.orders drop column total_cents;
    alter table public.orders add column total_cents integer generated always as (goods_cents + freight_cents + customs_cents + escrow_fee_cents) stored;
  end if;
end $$;

create or replace view public.supplier_active_orders with (security_invoker = true) as
  select o.id, o.product_id as listing_id, p.supplier_id, p.title as listing_title, o.order_type, o.quantity, o.batches,
         o.goods_cents, o.total_cents, o.escrow_status, o.fulfillment_status, o.current_status, o.funded_at, o.created_at,
         o.eta_timestamp, o.destination_label, o.tracking_number, o.carrier
    from public.orders o join public.products p on p.id = o.product_id
   where o.fulfillment_status not in ('awaiting_payment', 'void');
revoke all on public.supplier_active_orders from anon;
grant select on public.supplier_active_orders to authenticated;

-- New orders snapshot today's rates; the fee follows price edits only until money moves.
-- Named to fire before orders_payment_split (triggers run in name order), which splits the fee-inclusive total.
create or replace function public.orders_platform_fees()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_p public.platform_settings; v_supplier uuid; v_markup numeric;
begin
  if tg_op = 'INSERT' then
    select * into v_p from public.platform_settings where id;
    select supplier_id, freight_markup_percent into v_supplier, v_markup from public.products where id = new.product_id;
    new.commission_rate := case when public.is_gold_supplier(v_supplier) then v_p.supplier_gold_commission_rate
                                else v_p.default_supplier_commission_rate end;
    -- Pool pledges are paid per member (pool_members), not through the order total.
    new.escrow_fee_rate := case when new.order_type = 'pool' then 0 else coalesce(v_p.escrow_fee_percent, 0) end;
    new.logistics_markup_cents := case when coalesce(v_markup, 0) > 0 and new.freight_cents > 0
                                       then new.freight_cents - round(new.freight_cents / (1 + v_markup))::integer else 0 end;
    new.early_payout_requested_at := null;
    new.early_payout_fee_rate := null;
  elsif new.escrow_status::text <> 'pending_payment' or new.deposit_paid_at is not null then
    return new;
  end if;
  new.escrow_fee_cents := round((new.goods_cents + new.freight_cents + new.customs_cents)::numeric * coalesce(new.escrow_fee_rate, 0))::integer;
  return new;
end $$;
drop trigger if exists orders_escrow_fee on public.orders;
create trigger orders_escrow_fee before insert or update of goods_cents, freight_cents, customs_cents on public.orders
  for each row execute function public.orders_platform_fees();

-- Milestone split (021) over the fee-inclusive total.
create or replace function public.orders_payment_split()
returns trigger language plpgsql as $$
declare v_total integer := new.goods_cents + new.freight_cents + new.customs_cents + new.escrow_fee_cents;
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
alter table public.orders drop constraint if exists orders_milestone_amounts;
alter table public.orders add constraint orders_milestone_amounts check (
  payment_structure <> 'milestone_30_70'
  or (deposit_amount > 0 and remaining_balance >= 0 and deposit_amount + remaining_balance = goods_cents + freight_cents + customs_cents + escrow_fee_cents));

-- Listing approval (018): the freight an admin enters is the carrier cost; buyers see it with the logistics markup.
create or replace function public.admin_approve_product(
  p_product_id uuid, p_freight_cents integer, p_customs_cents integer, p_notes text default null
) returns public.products language plpgsql security definer set search_path = public as $$
declare v_product public.products; v_markup numeric; v_freight integer;
begin
  if not public.current_role_is('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_freight_cents is null or p_customs_cents is null
     or p_freight_cents < 0 or p_customs_cents < 0
     or p_freight_cents > 10000000 or p_customs_cents > 10000000 then
    raise exception 'Freight and customs must be between $0 and $100,000';
  end if;
  v_markup := coalesce((select logistics_markup_percent from public.platform_settings where id), 0);
  v_freight := round(p_freight_cents * (1 + v_markup))::integer;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'pending_review' then
    raise exception 'Product is not awaiting review (status: %)', v_product.status;
  end if;
  if v_product.trial_goods_cents + v_freight + p_customs_cents < public.trial_batch_min_cents() then
    raise exception 'Guaranteed Landed Cost must be at least $% (currently $%)',
      to_char(public.trial_batch_min_cents() / 100.0, 'FM999990.00'),
      to_char((v_product.trial_goods_cents + v_freight + p_customs_cents) / 100.0, 'FM999990.00');
  end if;

  update public.products
     set trial_freight_cents    = v_freight,
         trial_customs_cents    = p_customs_cents,
         freight_markup_percent = v_markup,
         status       = 'live',
         review_notes = nullif(trim(p_notes), ''),
         reviewed_by  = auth.uid(),
         reviewed_at  = now()
   where id = p_product_id
  returning * into v_product;
  return v_product;
end $$;

-- ── 5. FX spread on charges ─────────────────────────────────────────────────
alter table public.card_payments  add column if not exists fx_spread_percent numeric(6, 4) not null default 0;
alter table public.card_payments  add column if not exists fx_margin_cents   integer not null default 0;
alter table public.mpesa_payments add column if not exists fx_spread_percent numeric(6, 4) not null default 0;
alter table public.mpesa_payments add column if not exists fx_margin_cents   integer not null default 0;

create or replace function public.current_fx_spread()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select fx_spread_percent from public.platform_settings where id), 0)
$$;

-- begin_card_payment: same as 021; a non-USD charge also carries the FX spread.
-- usd_rate stays the base rate (refunds of part of a charge convert at it); amount_minor is what Paystack collects.
create or replace function public.begin_card_payment(
  p_kind text, p_ref_id uuid, p_buyer_id uuid, p_currency text, p_usd_rate numeric
) returns public.card_payments language plpgsql security definer set search_path = public as $$
declare
  v_attempt  record;
  v_currency text := upper(coalesce(p_currency, 'USD'));
  v_rate     numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_usd_rate end;
  v_spread   numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 0 else public.current_fx_spread() end;
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
                                    usd_cents, currency, usd_rate, amount_minor, leg, fx_spread_percent, fx_margin_cents)
  values (replace(v_attempt.o_tx_ref, '_', '.'), p_kind,
          case when p_kind = 'order' then p_ref_id end,
          case when p_kind = 'group' then p_ref_id end,
          case when p_kind = 'pool'  then p_ref_id end,
          p_buyer_id, v_attempt.o_amount_cents, v_currency, v_rate,
          case when v_currency = 'USD' then v_attempt.o_amount_cents else ceil(v_attempt.o_amount_cents * v_rate * (1 + v_spread))::bigint end,
          v_leg, v_spread, round(v_attempt.o_amount_cents * v_spread)::integer)
  returning * into v_payment;
  return v_payment;
end $$;

-- begin_mpesa_payment: same as 021, at the base rate × (1 + FX spread). kes_per_usd keeps the base rate.
create or replace function public.begin_mpesa_payment(
  p_order_id uuid, p_buyer_id uuid, p_phone text, p_kes_per_usd numeric, p_max_kes integer
) returns public.mpesa_payments language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_due      integer;
  v_leg      text;
  v_kes      integer;
  v_spread   numeric := public.current_fx_spread();
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

  v_kes := ceil(v_due * p_kes_per_usd * (1 + v_spread) / 100.0)::integer;
  if v_kes > p_max_kes then
    raise exception 'This payment is KES % — above the M-Pesa limit of KES % per transaction. Please pay by card.',
      to_char(v_kes, 'FM999,999,990'), to_char(p_max_kes, 'FM999,999,990');
  end if;

  insert into public.mpesa_payments (order_id, buyer_id, phone, usd_cents, kes_per_usd, amount_kes, leg, fx_spread_percent, fx_margin_cents)
  values (p_order_id, p_buyer_id, p_phone, v_due, p_kes_per_usd, v_kes, v_leg, v_spread, round(v_due * v_spread)::integer)
  returning * into v_payment;
  return v_payment;
end $$;

-- begin_mpesa_group_payment: same as 008, at the base rate × (1 + FX spread).
create or replace function public.begin_mpesa_group_payment(
  p_group_id uuid, p_buyer_id uuid, p_phone text, p_kes_per_usd numeric, p_max_kes integer
) returns public.mpesa_payments language plpgsql security definer set search_path = public as $$
declare
  v_total   integer;
  v_count   integer;
  v_kes     integer;
  v_spread  numeric := public.current_fx_spread();
  v_payment public.mpesa_payments;
begin
  if p_kes_per_usd is null or p_kes_per_usd < 50 or p_kes_per_usd > 500 then
    raise exception 'M-Pesa exchange rate is not configured correctly';
  end if;

  -- Locks the group row, so concurrent attempts for one cart run one at a time.
  update public.checkout_groups g set payment_attempts = g.payment_attempts + 1
   where g.id = p_group_id and g.buyer_id = p_buyer_id;
  if not found then raise exception 'Checkout not found'; end if;

  if exists (select 1 from public.mpesa_payments
              where checkout_group_id = p_group_id and status in ('initiating', 'pending')
                and created_at > now() - interval '2 minutes') then
    raise exception 'An M-Pesa prompt was already sent for this checkout. Check your phone, or try again in 2 minutes.';
  end if;

  update public.orders set payment_attempts = payment_attempts + 1
   where checkout_group_id = p_group_id and escrow_status = 'pending_payment';
  select coalesce(sum(total_cents), 0), count(*) into v_total, v_count
    from public.orders where checkout_group_id = p_group_id and escrow_status = 'pending_payment';
  if v_count = 0 then raise exception 'Nothing left to pay in this checkout'; end if;

  v_kes := ceil(v_total * p_kes_per_usd * (1 + v_spread) / 100.0)::integer;
  if v_kes > p_max_kes then
    raise exception 'This checkout is KES % — above the M-Pesa limit of KES % per transaction. Remove some items or pay by card.',
      to_char(v_kes, 'FM999,999,990'), to_char(p_max_kes, 'FM999,999,990');
  end if;

  insert into public.mpesa_payments (checkout_group_id, buyer_id, phone, usd_cents, kes_per_usd, amount_kes, fx_spread_percent, fx_margin_cents)
  values (p_group_id, p_buyer_id, p_phone, v_total, p_kes_per_usd, v_kes, v_spread, round(v_total * v_spread)::integer)
  returning * into v_payment;
  return v_payment;
end $$;

-- ── 6. Card purchases: Gold Supplier and RFQ add-ons ────────────────────────
alter table public.card_payments add column if not exists rfq_id   uuid references public.rfqs (id) on delete set null;
alter table public.card_payments add column if not exists purchase jsonb;
alter table public.card_payments drop constraint if exists card_payments_kind_check;
alter table public.card_payments add constraint card_payments_kind_check
  check (kind in ('order', 'group', 'pool', 'subscription', 'rfq_addon'));
alter table public.card_payments drop constraint if exists card_payments_one_target;
alter table public.card_payments add constraint card_payments_one_target check (
  (kind = 'order' and order_id is not null and checkout_group_id is null and pool_id is null and rfq_id is null) or
  (kind = 'group' and checkout_group_id is not null and order_id is null and pool_id is null and rfq_id is null) or
  (kind = 'pool'  and pool_id is not null and order_id is null and checkout_group_id is null and rfq_id is null) or
  (kind = 'subscription' and order_id is null and checkout_group_id is null and pool_id is null and rfq_id is null and purchase ? 'plan') or
  -- rfq_id may become null if the buyer later deletes the request; the payment stays as the revenue record.
  (kind = 'rfq_addon' and order_id is null and checkout_group_id is null and pool_id is null and purchase ? 'addons'));
create index if not exists card_payments_rfq_idx on public.card_payments (rfq_id) where rfq_id is not null;
create index if not exists card_payments_revenue_idx on public.card_payments (kind, completed_at) where status = 'succeeded';

-- Start a Gold Supplier month or an RFQ add-on charge. Price from platform_settings, never the client.
-- p_addons: subset of {featured, white_glove} (rfq_addon only).
create or replace function public.begin_card_purchase(
  p_kind text, p_user uuid, p_rfq_id uuid, p_addons text[], p_currency text, p_usd_rate numeric
) returns public.card_payments language plpgsql security definer set search_path = public as $$
declare
  v_p        public.platform_settings;
  v_role     text;
  v_rfq      public.rfqs;
  v_addons   text[];
  v_currency text := upper(coalesce(p_currency, 'USD'));
  v_rate     numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_usd_rate end;
  v_spread   numeric := 0;
  v_cents    integer;
  v_purchase jsonb;
  v_ref      text := replace(gen_random_uuid()::text, '-', '');
  v_payment  public.card_payments;
begin
  if v_rate is null or v_rate <= 0 then raise exception 'Card payment exchange rate is not configured correctly'; end if;
  select * into v_p from public.platform_settings where id;
  if not found then raise exception 'Pricing is not configured (run migration 026)'; end if;
  select role::text into v_role from public.profiles where id = p_user;
  if not found then raise exception 'Account not found'; end if;

  if p_kind = 'subscription' then
    if v_role <> 'supplier' then raise exception 'Gold Supplier is available to supplier accounts' using errcode = '42501'; end if;
    v_cents := round(v_p.supplier_gold_monthly_price * 100)::integer;
    v_purchase := jsonb_build_object('plan', 'gold_supplier', 'months', 1, 'price_cents', v_cents);
    v_ref := 'sub.' || v_ref;
  elsif p_kind = 'rfq_addon' then
    select * into v_rfq from public.rfqs where id = p_rfq_id and buyer_id = p_user for update;
    if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
    if v_rfq.status not in ('open', 'quoted') or v_rfq.expires_at <= now() then
      raise exception 'Add-ons are only available while a request is collecting quotes';
    end if;
    select array_agg(distinct a order by a) into v_addons from unnest(coalesce(p_addons, '{}'::text[])) a;
    if v_addons is null or not (v_addons <@ array['featured', 'white_glove']) then
      raise exception 'Choose Featured RFQ, White-Glove Sourcing, or both';
    end if;
    if 'featured' = any (v_addons) and v_rfq.is_featured then raise exception 'This request is already featured'; end if;
    if 'white_glove' = any (v_addons) and v_rfq.needs_white_glove then raise exception 'White-glove sourcing is already requested for this request'; end if;
    v_purchase := jsonb_build_object('addons', to_jsonb(v_addons), 'rfq_title', v_rfq.title,
      'featured_cents',    case when 'featured' = any (v_addons)    then round(v_p.featured_rfq_price * 100)::integer else 0 end,
      'white_glove_cents', case when 'white_glove' = any (v_addons) then round(v_p.white_glove_sourcing_fee * 100)::integer else 0 end);
    v_cents := (v_purchase ->> 'featured_cents')::integer + (v_purchase ->> 'white_glove_cents')::integer;
    v_ref := 'rfq.' || v_ref;
  else
    raise exception 'Unknown purchase %', p_kind;
  end if;

  if v_currency <> 'USD' then v_spread := v_p.fx_spread_percent; end if;
  insert into public.card_payments (reference, kind, rfq_id, purchase, buyer_id, usd_cents, currency, usd_rate, amount_minor,
                                    fx_spread_percent, fx_margin_cents)
  values (v_ref, p_kind, case when p_kind = 'rfq_addon' then p_rfq_id end, v_purchase, p_user, v_cents, v_currency, v_rate,
          case when v_currency = 'USD' then v_cents else ceil(v_cents * v_rate * (1 + v_spread))::bigint end,
          v_spread, round(v_cents * v_spread)::integer)
  returning * into v_payment;
  return v_payment;
end $$;

-- Paid white-glove request → a support ticket the ops team picks up in /admin/support (and can reply to).
create or replace function public.open_white_glove_ticket(p_rfq public.rfqs)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ticket uuid;
begin
  insert into public.support_tickets (user_id, category, subject)
  values (p_rfq.buyer_id, 'other', left('White-glove sourcing: ' || p_rfq.title, 140))
  returning id into v_ticket;
  insert into public.support_messages (ticket_id, sender_id, sender_role, body)
  values (v_ticket, p_rfq.buyer_id, 'customer', left(format(
    E'White-glove sourcing paid for request "%s" (%s %s, deliver to %s).\nPlease match vetted factory quotes.\nRequest: /rfqs/%s',
    p_rfq.title, p_rfq.quantity, coalesce(p_rfq.unit_of_measure, 'units'), p_rfq.delivery_location, p_rfq.id), 4000));
  return v_ticket;
end $$;

-- apply_card_payment: same as 021, plus Gold Supplier months and RFQ add-ons.
create or replace function public.apply_card_payment(
  p_reference text, p_provider_ref text, p_amount_minor bigint, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay     public.card_payments;
  v_order   public.orders;
  v_member  public.pool_members;
  v_pool    public.trend_pools;
  v_rfq     public.rfqs;
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

  elsif v_pay.kind = 'subscription' then
    -- One month from today, or from the end of a period still running (paying early extends it).
    insert into public.subscriptions (user_id, plan_type, status, current_period_end)
    values (v_pay.buyer_id, v_pay.purchase ->> 'plan', 'active', now() + interval '1 month')
    on conflict (user_id, plan_type) do update
      set status = 'active',
          current_period_end = greatest(coalesce(subscriptions.current_period_end, now()), now()) + interval '1 month';
    v_outcome := 'subscription_activated';

  elsif v_pay.kind = 'rfq_addon' then
    select * into v_rfq from public.rfqs where id = v_pay.rfq_id for update;
    if not found then
      v_why := 'The request was deleted before this add-on payment completed — refund the buyer';
    elsif v_rfq.status not in ('open', 'quoted') or v_rfq.expires_at <= now() then
      v_why := format('Request was already %s when this add-on payment completed — refund the buyer', v_rfq.status);
    elsif (v_pay.purchase -> 'addons' ? 'featured' and v_rfq.is_featured)
       or (v_pay.purchase -> 'addons' ? 'white_glove' and v_rfq.needs_white_glove) then
      v_why := 'An add-on in this payment was already active (paid twice) — refund the duplicate';
    else
      update public.rfqs
         set is_featured              = is_featured or (v_pay.purchase -> 'addons' ? 'featured'),
             featured_at              = case when v_pay.purchase -> 'addons' ? 'featured' then now() else featured_at end,
             needs_white_glove        = needs_white_glove or (v_pay.purchase -> 'addons' ? 'white_glove'),
             white_glove_requested_at = case when v_pay.purchase -> 'addons' ? 'white_glove' then now() else white_glove_requested_at end
       where id = v_rfq.id
      returning * into v_rfq;
      if v_pay.purchase -> 'addons' ? 'white_glove' then perform public.open_white_glove_ticket(v_rfq); end if;
      v_outcome := 'rfq_addon_applied';
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

-- ── 7. Payouts: per-order commission and instant early payout ───────────────
alter table public.payouts add column if not exists early                  boolean not null default false;
alter table public.payouts add column if not exists early_payout_fee_cents integer not null default 0;
do $$ begin
  alter table public.payouts add constraint payouts_early_fee_valid check (early_payout_fee_cents >= 0 and early_payout_fee_cents <= fee_cents);
exception when duplicate_object then null; end $$;

-- Everything the buyer owes is in escrow (a milestone order's balance included).
create or replace function public.order_fully_paid(p public.orders)
returns boolean language sql stable as $$
  select case when p.payment_structure = 'milestone_30_70' then p.final_paid_at is not null else p.funded_at is not null end
$$;

-- Supplier (or admin) view: may this order be paid out early, and what would the supplier receive?
create or replace function public.early_payout_quote(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_supplier uuid;
  v_ship     public.shipments;
  v_acct     public.supplier_payout_accounts;
  v_rate     numeric;
  v_comm     integer;
  v_fee      integer;
  v_reason   text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select supplier_id into v_supplier from public.products where id = v_order.product_id;
  if v_supplier is distinct from auth.uid() and not public.current_role_is('admin') then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  select * into v_ship from public.shipments where order_id = p_order_id;
  select * into v_acct from public.supplier_payout_accounts where supplier_id = v_supplier;
  v_rate := coalesce(v_order.early_payout_fee_rate, (select early_payout_discount_fee from public.platform_settings where id), 0);
  v_reason := case
    when v_order.early_payout_requested_at is not null then 'Early payout already requested'
    when exists (select 1 from public.payouts where order_id = p_order_id) then 'The payout for this order has already started'
    when v_order.escrow_status::text = 'released' then 'Escrow is released — the standard payout applies'
    when v_order.escrow_status::text not in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification')
      then 'Not available while the order is ' || replace(v_order.escrow_status::text, '_', ' ')
    when not public.order_fully_paid(v_order) then 'Available once the buyer has paid in full (including the 70% balance)'
    when v_ship.order_id is null or v_ship.status = 'label_created' then 'Add the waybill and mark the order dispatched first'
    when not coalesce((select kyc_verified from public.profiles where id = v_supplier), false) then 'Complete supplier verification (KYC) first'
    when v_acct.supplier_id is null or not v_acct.verified then 'Add a verified payout account first'
  end;
  v_comm := case when v_order.commission_rate is null then null else floor(v_order.goods_cents * v_order.commission_rate)::integer end;
  v_fee := floor(v_order.goods_cents * v_rate)::integer;
  return jsonb_build_object(
    'eligible', v_reason is null, 'reason', v_reason, 'requested_at', v_order.early_payout_requested_at,
    'gross_cents', v_order.goods_cents, 'commission_rate', v_order.commission_rate, 'commission_cents', v_comm,
    'fee_rate', v_rate, 'fee_cents', v_fee,
    'net_cents', case when v_comm is null then null else v_order.goods_cents - v_comm - v_fee end);
end $$;

-- Supplier asks for the early payout; the app then runs the normal payout (processPayout → begin_payout).
create or replace function public.request_early_payout(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_quote jsonb;
begin
  if not public.current_role_is('supplier') or not public.is_order_supplier(p_order_id) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  v_quote := public.early_payout_quote(p_order_id);
  if not (v_quote ->> 'eligible')::boolean then raise exception '%', v_quote ->> 'reason'; end if;
  update public.orders set early_payout_requested_at = now(), early_payout_fee_rate = (v_quote ->> 'fee_rate')::numeric
   where id = p_order_id;
  insert into public.escrow_events (order_id, from_status, to_status, event_type, note, metadata)
  values (p_order_id, v_order.escrow_status, v_order.escrow_status, 'early_payout_requested',
          'Supplier requested an instant early payout (SokoGlobal-backed; buyer escrow protection unchanged)',
          jsonb_build_object('fee_rate', v_quote -> 'fee_rate', 'fee_cents', v_quote -> 'fee_cents'));
  return v_quote || jsonb_build_object('eligible', false, 'requested_at', now());
end $$;

-- Replaces 004: per-order commission, early payouts, and escrow events tagged with the order's real state.
create or replace function public.begin_payout(p_order_id uuid, p_fee_bps integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_supplier uuid;
  v_payout   public.payouts;
  v_acct     public.supplier_payout_accounts;
  v_number   text;
  v_kyc_ok   boolean;
  v_early    boolean;
  v_comm     integer;
  v_early_fee integer;
  v_hold     text;
begin
  if p_fee_bps < 0 or p_fee_bps > 3000 then raise exception 'Fee out of range'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order is not released'; end if;
  v_early := v_order.escrow_status <> 'released';
  if v_early and not (v_order.early_payout_requested_at is not null
                      and v_order.escrow_status::text in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification')
                      and public.order_fully_paid(v_order)) then
    raise exception 'Order is not released';
  end if;
  select supplier_id into v_supplier from public.products where id = v_order.product_id;

  select kyc_verified into v_kyc_ok from public.profiles where id = v_supplier;
  select * into v_acct from public.supplier_payout_accounts where supplier_id = v_supplier;
  if v_acct.account_number_secret_id is not null then
    select decrypted_secret into v_number from vault.decrypted_secrets where id = v_acct.account_number_secret_id;
  end if;
  v_hold := case
    when not coalesce(v_kyc_ok, false) then 'Supplier KYC not approved'
    when v_acct.supplier_id is null     then 'No payout account on file'
    when not v_acct.verified            then 'Payout account not verified'
    when v_number is null               then 'Payout account number missing from Vault'
    when v_acct.currency <> all (public.supported_payout_currencies())
                                        then 'Unsupported payout currency ' || v_acct.currency
  end;

  select * into v_payout from public.payouts where order_id = p_order_id for update;
  if found then
    if v_payout.status in ('processing', 'succeeded') then
      return jsonb_build_object('action', 'skip', 'status', v_payout.status, 'payout_id', v_payout.id);
    end if;
    if v_payout.status = 'failed' and v_payout.attempts >= 5 then
      return jsonb_build_object('action', 'hold', 'reason', 'Max payout attempts reached — manual review', 'payout_id', v_payout.id);
    end if;
    -- An early payout that never went out before the buyer confirmed is an ordinary payout now: no early fee.
    if v_payout.early and not v_early then
      update public.payouts
         set early = false, fee_cents = fee_cents - early_payout_fee_cents, amount_cents = amount_cents + early_payout_fee_cents,
             early_payout_fee_cents = 0
       where id = v_payout.id returning * into v_payout;
    end if;
    if v_hold is not null then
      update public.payouts set status = 'on_hold', failure_reason = v_hold, updated_at = now() where id = v_payout.id;
      return jsonb_build_object('action', 'hold', 'reason', v_hold, 'payout_id', v_payout.id);
    end if;
    update public.payouts
       set status = 'processing', attempts = attempts + 1, failure_reason = null, updated_at = now(),
           reference = 'payout_' || p_order_id || '-' || (attempts + 1),
           payout_currency = null, payout_amount = null, fx_rate = null, fx_source_cents = null, fx_quoted_at = null
     where id = v_payout.id returning * into v_payout;
  else
    -- Commission snapshotted on the order (026); older orders use the app's PLATFORM_FEE_BPS.
    v_comm := case when v_order.commission_rate is not null then floor(v_order.goods_cents * v_order.commission_rate)
                   else floor(v_order.goods_cents::numeric * p_fee_bps / 10000) end;
    v_early_fee := case when v_early then floor(v_order.goods_cents * coalesce(v_order.early_payout_fee_rate, 0)) else 0 end;
    if v_comm + v_early_fee >= v_order.goods_cents then raise exception 'Fees exceed the goods value'; end if;
    insert into public.payouts (order_id, supplier_id, gross_cents, fee_cents, amount_cents, currency, reference, status, failure_reason,
                                early, early_payout_fee_cents)
    values (p_order_id, v_supplier, v_order.goods_cents, v_comm + v_early_fee, v_order.goods_cents - v_comm - v_early_fee, v_order.currency,
            'payout_' || p_order_id || '-1',
            case when v_hold is null then 'processing' else 'on_hold' end::public.payout_status, v_hold,
            v_early, v_early_fee)
    returning * into v_payout;
    if v_hold is not null then
      insert into public.escrow_events (order_id, from_status, to_status, event_type, note, metadata)
      values (p_order_id, v_order.escrow_status, v_order.escrow_status, 'payout_on_hold', v_hold, jsonb_build_object('early', v_early));
      return jsonb_build_object('action', 'hold', 'reason', v_hold, 'payout_id', v_payout.id);
    end if;
  end if;

  return jsonb_build_object(
    'action', 'transfer', 'payout_id', v_payout.id, 'reference', v_payout.reference,
    'amount_cents', v_payout.amount_cents, 'currency', v_payout.currency,
    'account', jsonb_build_object(
      'method', v_acct.method, 'bank_code', v_acct.bank_code, 'bank_name', v_acct.bank_name,
      'account_number', v_number, 'beneficiary_name', v_acct.beneficiary_name,
      'country_code', v_acct.country_code, 'currency', v_acct.currency, 'international', v_acct.international));
end $$;

-- Replaces 004: events carry the order's escrow state (an early payout happens before release) and the early flag.
create or replace function public.finish_payout(p_payout_id uuid, p_initiated boolean, p_transfer_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_payout public.payouts; v_status public.escrow_status;
begin
  update public.payouts
     set status = case when p_initiated then 'processing' else 'failed' end::public.payout_status,
         flw_transfer_id = coalesce(p_transfer_id, flw_transfer_id),
         failure_reason = case when p_initiated then null else left(p_error, 1000) end,
         updated_at = now()
   where id = p_payout_id and status = 'processing'
  returning * into v_payout;
  if not found then return; end if;
  select escrow_status into v_status from public.orders where id = v_payout.order_id;

  insert into public.escrow_events (order_id, from_status, to_status, event_type, provider_ref, note, metadata)
  values (v_payout.order_id, v_status, v_status,
          case when p_initiated then 'payout_initiated' else 'payout_failed' end,
          p_transfer_id,
          case when p_initiated then case when v_payout.early then 'Early payout: Flutterwave transfer initiated' else 'Flutterwave transfer initiated' end
               else left(p_error, 500) end,
          jsonb_strip_nulls(jsonb_build_object(
            'payout_id', v_payout.id, 'reference', v_payout.reference,
            'amount_cents', v_payout.amount_cents, 'currency', v_payout.currency,
            'payout_currency', v_payout.payout_currency, 'payout_amount', v_payout.payout_amount,
            'fx_rate', v_payout.fx_rate, 'early', case when v_payout.early then true end)));
end $$;

-- Replaces 003: same, with the order's escrow state on the event.
create or replace function public.complete_payout(p_reference text, p_transfer_id text, p_success boolean, p_message text)
returns text language plpgsql security definer set search_path = public as $$
declare v_payout public.payouts; v_status public.escrow_status;
begin
  select * into v_payout from public.payouts where reference = p_reference for update;
  if not found then return 'unknown_payout'; end if;
  if v_payout.status <> 'processing' then return 'already_processed'; end if;

  update public.payouts
     set status = case when p_success then 'succeeded' else 'failed' end::public.payout_status,
         flw_transfer_id = coalesce(flw_transfer_id, p_transfer_id),
         failure_reason = case when p_success then null else left(p_message, 1000) end,
         completed_at = case when p_success then now() end, updated_at = now()
   where id = v_payout.id;
  select escrow_status into v_status from public.orders where id = v_payout.order_id;
  insert into public.escrow_events (order_id, from_status, to_status, event_type, provider_ref, note, metadata)
  values (v_payout.order_id, v_status, v_status,
          case when p_success then 'payout_succeeded' else 'payout_failed' end, p_transfer_id, left(p_message, 500),
          case when v_payout.early then jsonb_build_object('early', true) end);
  return case when p_success then 'payout_succeeded' else 'payout_failed' end;
end $$;

-- ── 8. Revenue (super admins) ───────────────────────────────────────────────
-- USD cents per stream since p_since (null = all time). Gross of refunds except where noted.
create or replace function public.super_platform_revenue(p_since timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'subscriptions_cents', (select coalesce(sum(usd_cents), 0) from public.card_payments
                             where kind = 'subscription' and status = 'succeeded' and completed_at >= v_since),
    'rfq_featured_cents', (select coalesce(sum((purchase ->> 'featured_cents')::bigint), 0) from public.card_payments
                            where kind = 'rfq_addon' and status = 'succeeded' and completed_at >= v_since),
    'rfq_white_glove_cents', (select coalesce(sum((purchase ->> 'white_glove_cents')::bigint), 0) from public.card_payments
                               where kind = 'rfq_addon' and status = 'succeeded' and completed_at >= v_since),
    -- Funded orders that were not refunded.
    'escrow_fees_cents', (select coalesce(sum(escrow_fee_cents), 0) from public.orders
                           where funded_at >= v_since and escrow_status::text not in ('refunded', 'cancelled')),
    'logistics_markup_cents', (select coalesce(sum(logistics_markup_cents), 0) from public.orders
                                where funded_at >= v_since and escrow_status::text not in ('refunded', 'cancelled')),
    'fx_margin_cents', (select coalesce(sum(fx_margin_cents), 0) from public.card_payments where status = 'succeeded' and completed_at >= v_since)
                     + (select coalesce(sum(fx_margin_cents), 0) from public.mpesa_payments where status = 'succeeded' and completed_at >= v_since),
    'commission_cents', (select coalesce(sum(fee_cents - early_payout_fee_cents), 0) from public.payouts
                          where status = 'succeeded' and completed_at >= v_since),
    'early_payout_fees_cents', (select coalesce(sum(early_payout_fee_cents), 0) from public.payouts
                                 where status = 'succeeded' and completed_at >= v_since),
    -- Point-in-time figures (not windowed).
    'active_gold_suppliers', (select count(*) from public.subscriptions
                               where plan_type = 'gold_supplier' and status = 'active' and current_period_end > now()),
    'early_payout_exposure_cents', (select coalesce(sum(p.amount_cents), 0) from public.payouts p join public.orders o on o.id = p.order_id
                                     where p.early and p.status in ('processing', 'succeeded') and o.escrow_status::text <> 'released'),
    'early_payouts_open', (select count(*) from public.payouts p join public.orders o on o.id = p.order_id
                            where p.early and p.status in ('processing', 'succeeded') and o.escrow_status::text <> 'released'),
    'white_glove_open', (select count(*) from public.rfqs where needs_white_glove and status in ('open', 'quoted') and expires_at > now()));
end $$;

-- ── 9. Grants ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Service role only (webhooks, payout worker, crons).
  foreach f in array array['public.begin_card_purchase(text, uuid, uuid, text[], text, numeric)', 'public.open_white_glove_ticket(public.rfqs)',
                           'public.expire_lapsed_subscriptions()', 'public.begin_card_payment(text, uuid, uuid, text, numeric)',
                           'public.apply_card_payment(text, text, bigint, text)', 'public.begin_mpesa_payment(uuid, uuid, text, numeric, integer)',
                           'public.begin_mpesa_group_payment(uuid, uuid, text, numeric, integer)', 'public.begin_payout(uuid, integer)',
                           'public.finish_payout(uuid, boolean, text, text)', 'public.complete_payout(text, text, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Signed-in users (each function checks the caller itself).
  foreach f in array array['public.super_set_platform_pricing(jsonb, text, text)', 'public.super_platform_revenue(timestamptz)',
                           'public.early_payout_quote(uuid)', 'public.request_early_payout(uuid)', 'public.supplier_rfq_feed()',
                           'public.is_gold_supplier(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.gold_supplier_ids(uuid[]) to anon, authenticated;
grant execute on function public.current_fx_spread() to anon, authenticated;
