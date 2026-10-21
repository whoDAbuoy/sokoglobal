-- =============================================================================
-- SokoGlobal — Migration 018: system configs (trial batches, KYC switches),
-- payment-gated supplier order visibility, grouped supplier catalogue.
-- Run after 017. Re-runnable.
--
--  * system_configs: key → JSONB, readable by everyone, changed only through
--    super_set_system_config() (validated per key, audited).
--      trial_batch_config  {"enabled": true, "minimum_amount": 500.00, "currency": "USD"}
--      kyc_requirements    {"listings": true, "orders": true}
--  * trial_batch_min_cents() now reads the config, so every existing function
--    (approval, checkout, cart) follows the control room. The two hard-coded
--    $500 CHECK constraints become triggers using check_trial_batch_validity().
--  * orders.fulfillment_status is derived from escrow + shipment state. It only
--    becomes 'pending_fulfillment' when escrow is funded, which only the
--    service-role payment functions do after Paystack / M-Pesa verification
--    (signed webhook, server-side verify or Daraja callback). A trigger now
--    refuses any other session that tries to move an order out of
--    pending_payment.
--  * Suppliers no longer see unpaid orders at all (RLS), via the
--    supplier_active_orders view or anywhere else.
-- =============================================================================

-- ── 1. Config store ─────────────────────────────────────────────────────────
create table if not exists public.system_configs (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  value      jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 8192),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.system_configs enable row level security;
drop policy if exists "system_configs: everyone reads" on public.system_configs;
create policy "system_configs: everyone reads" on public.system_configs for select using (true);
revoke all on public.system_configs from anon, authenticated;
grant select on public.system_configs to anon, authenticated;

insert into public.system_configs (key, value) values
  ('trial_batch_config', '{"enabled": true, "minimum_amount": 500.00, "currency": "USD"}'),
  ('kyc_requirements',   '{"listings": true, "orders": true}')
on conflict (key) do nothing;

create or replace function public.system_config(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.system_configs where key = p_key
$$;

-- ── 2. Trial batch rules ────────────────────────────────────────────────────
-- Replaces the immutable $500 constant from schema.sql (now STABLE: it reads the config).
create or replace function public.trial_batch_min_cents()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(round((public.system_config('trial_batch_config') ->> 'minimum_amount')::numeric * 100)::integer, 50000)
$$;

create or replace function public.trial_batches_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.system_config('trial_batch_config') ->> 'enabled')::boolean, true)
$$;

-- { valid, enabled, minimum_amount, currency, reason } for an order amount in dollars.
create or replace function public.check_trial_batch_validity(order_amount numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := coalesce(public.system_config('trial_batch_config'), '{"enabled": true, "minimum_amount": 500.00, "currency": "USD"}'::jsonb);
  v_enabled boolean := coalesce((c ->> 'enabled')::boolean, true);
  v_min numeric := coalesce((c ->> 'minimum_amount')::numeric, 500);
  v_reason text;
begin
  v_reason := case
    when not v_enabled then 'Trial batches are paused right now'
    when order_amount is null or order_amount < v_min then format('Trial batches start at %s %s landed', coalesce(c ->> 'currency', 'USD'), to_char(v_min, 'FM999G999G990D00'))
    else null end;
  return jsonb_build_object('valid', v_reason is null, 'enabled', v_enabled, 'minimum_amount', v_min,
                            'currency', coalesce(c ->> 'currency', 'USD'), 'reason', v_reason);
end $$;

-- Orders: the hard-coded constraint becomes a config-aware trigger (new trial orders + price edits).
alter table public.orders drop constraint if exists trial_min_landed_cost;
create or replace function public.guard_trial_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if new.order_type <> 'trial' then return new; end if;
  if tg_op = 'UPDATE' and new.goods_cents = old.goods_cents and new.freight_cents = old.freight_cents and new.customs_cents = old.customs_cents then
    return new;
  end if;
  r := public.check_trial_batch_validity((new.goods_cents + new.freight_cents + new.customs_cents) / 100.0);
  -- Price edits on existing orders only need the minimum; pausing trial batches stops new ones.
  if (tg_op = 'INSERT' and not (r ->> 'valid')::boolean)
     or (tg_op = 'UPDATE' and (new.goods_cents + new.freight_cents + new.customs_cents) < public.trial_batch_min_cents()) then
    raise exception '%', coalesce(r ->> 'reason', 'Trial batch below platform minimum') using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists orders_trial_guard on public.orders;
create trigger orders_trial_guard before insert or update of goods_cents, freight_cents, customs_cents on public.orders
  for each row execute function public.guard_trial_order();

-- Products: going live needs the current minimum (existing live listings are left alone).
alter table public.products drop constraint if exists live_requires_trial_min;
create or replace function public.guard_live_minimum()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live'
     and (tg_op = 'INSERT' or old.status is distinct from 'live'
          or (new.trial_goods_cents + new.trial_freight_cents + new.trial_customs_cents)
             < (old.trial_goods_cents + old.trial_freight_cents + old.trial_customs_cents))
     and (new.trial_goods_cents + new.trial_freight_cents + new.trial_customs_cents) < public.trial_batch_min_cents() then
    raise exception 'Guaranteed Landed Cost must be at least $% for a trial batch', to_char(public.trial_batch_min_cents() / 100.0, 'FM999G999G990D00')
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists products_live_minimum on public.products;
create trigger products_live_minimum before insert or update on public.products
  for each row execute function public.guard_live_minimum();

-- Same function as migration 002, with the minimum in the message taken from the config.
create or replace function public.admin_approve_product(
  p_product_id uuid, p_freight_cents integer, p_customs_cents integer, p_notes text default null
) returns public.products language plpgsql security definer set search_path = public as $$
declare v_product public.products;
begin
  if not public.current_role_is('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_freight_cents is null or p_customs_cents is null
     or p_freight_cents < 0 or p_customs_cents < 0
     or p_freight_cents > 10000000 or p_customs_cents > 10000000 then
    raise exception 'Freight and customs must be between $0 and $100,000';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'pending_review' then
    raise exception 'Product is not awaiting review (status: %)', v_product.status;
  end if;
  if v_product.trial_goods_cents + p_freight_cents + p_customs_cents < public.trial_batch_min_cents() then
    raise exception 'Guaranteed Landed Cost must be at least $% (currently $%)',
      to_char(public.trial_batch_min_cents() / 100.0, 'FM999990.00'),
      to_char((v_product.trial_goods_cents + p_freight_cents + p_customs_cents) / 100.0, 'FM999990.00');
  end if;

  update public.products
     set trial_freight_cents = p_freight_cents,
         trial_customs_cents = p_customs_cents,
         status       = 'live',
         review_notes = nullif(trim(p_notes), ''),
         reviewed_by  = auth.uid(),
         reviewed_at  = now()
   where id = p_product_id
  returning * into v_product;
  return v_product;
end $$;

-- ── 3. KYC switches: kyc_required_for() (migration 017) reads kyc_requirements from here. ──

-- ── 4. Config writes (super admins, validated, audited) ─────────────────────
create or replace function public.validate_system_config(p_key text, p_value jsonb)
returns jsonb language plpgsql immutable as $$
declare v_min numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then raise exception 'Config must be a JSON object'; end if;
  case p_key
    when 'trial_batch_config' then
      if jsonb_typeof(p_value -> 'enabled') <> 'boolean' then raise exception 'enabled must be true or false'; end if;
      if jsonb_typeof(p_value -> 'minimum_amount') <> 'number' then raise exception 'minimum_amount must be a number'; end if;
      v_min := (p_value ->> 'minimum_amount')::numeric;
      if v_min < 1 or v_min > 1000000 or v_min <> round(v_min, 2) then
        raise exception 'Minimum must be between 1.00 and 1,000,000.00 with at most 2 decimals';
      end if;
      if coalesce(p_value ->> 'currency', 'USD') <> 'USD' then raise exception 'Escrow is held in USD; currency must be USD'; end if;
      return jsonb_build_object('enabled', (p_value ->> 'enabled')::boolean, 'minimum_amount', round(v_min, 2), 'currency', 'USD');
    when 'kyc_requirements' then
      if jsonb_typeof(p_value -> 'listings') <> 'boolean' or jsonb_typeof(p_value -> 'orders') <> 'boolean' then
        raise exception 'listings and orders must be true or false';
      end if;
      return jsonb_build_object('listings', (p_value ->> 'listings')::boolean, 'orders', (p_value ->> 'orders')::boolean);
    else
      raise exception 'Unknown config key %', p_key;
  end case;
end $$;

create or replace function public.super_set_system_config(p_key text, p_value jsonb, p_ip text default null, p_ua text default null)
returns public.system_configs language plpgsql security definer set search_path = public as $$
declare v public.system_configs; v_old jsonb; v_clean jsonb := public.validate_system_config(p_key, p_value);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select value into v_old from public.system_configs where key = p_key for update;
  insert into public.system_configs (key, value, updated_at, updated_by) values (p_key, v_clean, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid()
  returning * into v;
  perform public.write_admin_audit('config.' || p_key, 'config', p_key, jsonb_build_object('from', v_old, 'to', v_clean), p_ip, p_ua);
  return v;
end $$;

-- ── 5. Payment-gated order visibility ───────────────────────────────────────
alter table public.orders add column if not exists fulfillment_status text generated always as (
  case
    when escrow_status = 'pending_payment' then 'awaiting_payment'
    when escrow_status = 'cancelled' and funded_at is null then 'void'
    when escrow_status in ('cancelled', 'refunded') then 'closed'
    when escrow_status = 'released' then 'completed'
    when escrow_status = 'disputed' then 'on_hold'
    when escrow_status = 'delivered_pending_verification' then 'delivered'
    when escrow_status = 'funded' and current_status = 'awaiting_dispatch' then 'pending_fulfillment'
    else 'in_fulfillment'
  end) stored;
create index if not exists orders_pending_fulfillment_idx on public.orders (product_id, funded_at) where fulfillment_status = 'pending_fulfillment';

-- Only payment confirmation (service role, after provider verification) may take an order out of pending_payment.
create or replace function public.guard_order_funding()
returns trigger language plpgsql as $$
begin
  if old.escrow_status = 'pending_payment' and new.escrow_status not in ('pending_payment', 'cancelled') and auth.uid() is not null then
    raise exception 'Orders are funded only by a verified payment confirmation' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists orders_funding_guard on public.orders;
create trigger orders_funding_guard before update of escrow_status on public.orders
  for each row execute function public.guard_order_funding();

-- Suppliers see an order only once it is paid (never while awaiting payment, never unpaid cancellations).
alter policy "orders: supplier reads" on public.orders using (
  fulfillment_status not in ('awaiting_payment', 'void')
  and exists (select 1 from public.products p where p.id = product_id and p.supplier_id = (select auth.uid()))
);

create or replace view public.supplier_active_orders with (security_invoker = true) as
  select o.id, o.product_id as listing_id, p.supplier_id, p.title as listing_title, o.order_type, o.quantity, o.batches,
         o.goods_cents, o.total_cents, o.escrow_status, o.fulfillment_status, o.current_status, o.funded_at, o.created_at,
         o.eta_timestamp, o.destination_label, o.tracking_number, o.carrier
    from public.orders o join public.products p on p.id = o.product_id
   where o.fulfillment_status not in ('awaiting_payment', 'void');
revoke all on public.supplier_active_orders from anon;
grant select on public.supplier_active_orders to authenticated;

-- ── 6. Grouped supplier catalogue ───────────────────────────────────────────
-- One row per listing with paid orders waiting to be fulfilled, totals and per-buyer delivery details.
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
           'tracking_number', o.tracking_number, 'carrier', o.carrier) order by o.funded_at)
    from public.orders o
    join public.products p on p.id = o.product_id
    join public.profiles b on b.id = o.buyer_id
   where p.supplier_id = auth.uid() and o.fulfillment_status = 'pending_fulfillment'
   group by p.id, p.title, p.unit_of_measure
   order by min(o.funded_at)
$$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.super_set_system_config(text, jsonb, text, text) from public, anon;
grant execute on function public.super_set_system_config(text, jsonb, text, text) to authenticated;
revoke all on function public.get_supplier_grouped_catalog() from public, anon;
grant execute on function public.get_supplier_grouped_catalog() to authenticated;
grant execute on function public.check_trial_batch_validity(numeric) to anon, authenticated;
