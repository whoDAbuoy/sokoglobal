-- =============================================================================
-- SokoGlobal — Migration 008: multi-item cart checkout. Run after 007. Re-runnable.
--
-- A cart checkout creates one escrow ORDER per Trial Batch (escrow, delivery
-- verification, disputes and supplier payouts stay per order) and links them
-- to a CHECKOUT GROUP that the buyer pays once: one Flutterwave charge
-- (tx_ref grp_<uuid>) or one M-Pesa STK prompt. Confirming that payment funds
-- every still-unpaid order in the group atomically.
--
-- Orders in a group can only be paid through the group, so a group payment can
-- never collide with a per-order payment.
-- =============================================================================

create table if not exists public.checkout_groups (
  id               uuid primary key default gen_random_uuid(),
  buyer_id         uuid not null references public.profiles (id) on delete restrict,
  payment_attempts integer not null default 0,
  payment_provider text,
  payment_ref      text unique,
  funded_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists checkout_groups_buyer_idx on public.checkout_groups (buyer_id, created_at desc);

alter table public.orders add column if not exists checkout_group_id uuid references public.checkout_groups (id) on delete restrict;
create index if not exists orders_checkout_group_idx on public.orders (checkout_group_id) where checkout_group_id is not null;

alter table public.checkout_groups enable row level security;
drop policy if exists "checkout_groups: buyer reads own" on public.checkout_groups;
drop policy if exists "checkout_groups: admin reads"     on public.checkout_groups;
create policy "checkout_groups: buyer reads own" on public.checkout_groups for select using (buyer_id = (select auth.uid()));
create policy "checkout_groups: admin reads" on public.checkout_groups for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.checkout_groups from authenticated, anon;

-- M-Pesa attempts can now belong to an order OR a checkout group.
alter table public.mpesa_payments alter column order_id drop not null;
alter table public.mpesa_payments add column if not exists checkout_group_id uuid references public.checkout_groups (id) on delete restrict;
alter table public.mpesa_payments drop constraint if exists mpesa_payments_one_target;
alter table public.mpesa_payments add constraint mpesa_payments_one_target check ((order_id is null) <> (checkout_group_id is null));
create index if not exists mpesa_payments_group_idx on public.mpesa_payments (checkout_group_id, created_at desc) where checkout_group_id is not null;

-- ---------------------------------------------------------------------------
-- Create the orders for a cart. Prices are copied from the products
-- server-side, exactly like create_trial_order().
-- ---------------------------------------------------------------------------
create or replace function public.create_cart_checkout(p_product_ids uuid[])
returns public.checkout_groups language plpgsql security definer set search_path = public as $$
declare
  v_ids     uuid[];
  v_group   public.checkout_groups;
  v_product public.products;
  v_id      uuid;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can place orders' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_product_ids, '{}')) x where x is not null;
  if v_ids is null or array_length(v_ids, 1) = 0 then raise exception 'Your cart is empty'; end if;
  if array_length(v_ids, 1) > 10 then raise exception 'A cart can hold at most 10 Trial Batches'; end if;

  insert into public.checkout_groups (buyer_id) values (auth.uid()) returning * into v_group;

  foreach v_id in array v_ids loop
    select * into v_product from public.products where id = v_id and status = 'live';
    if not found then
      raise exception 'One of the products in your cart is no longer available — remove it and try again' using errcode = 'P0002';
    end if;
    if v_product.trial_landed_cost_cents < public.trial_batch_min_cents() then
      raise exception 'Trial batch below platform minimum';
    end if;
    insert into public.orders (buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents, checkout_group_id)
    values (auth.uid(), v_product.id, 'trial', v_product.trial_units,
            v_product.trial_goods_cents, v_product.trial_freight_cents, v_product.trial_customs_cents, v_group.id);
  end loop;

  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- begin_payment_attempt: same as 003 plus kind 'group'; per-order payment of
-- an order that belongs to a group is refused.
-- ---------------------------------------------------------------------------
create or replace function public.begin_payment_attempt(p_kind text, p_ref_id uuid, p_buyer_id uuid)
returns table (o_tx_ref text, o_amount_cents integer, o_currency text)
language plpgsql security definer set search_path = public as $$
declare v_attempt integer; v_amount integer; v_currency text; v_count integer;
begin
  if p_kind = 'order' then
    if exists (select 1 from public.orders where id = p_ref_id and checkout_group_id is not null) then
      raise exception 'This order is part of a cart checkout — pay it from the checkout page';
    end if;
    update public.orders o
       set payment_attempts = o.payment_attempts + 1
     where o.id = p_ref_id and o.buyer_id = p_buyer_id and o.escrow_status = 'pending_payment'
    returning o.payment_attempts, o.total_cents, o.currency into v_attempt, v_amount, v_currency;
    if not found then raise exception 'Order is not awaiting payment'; end if;
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
    -- Marks the orders as having a payment in flight (admin_remove_product
    -- only auto-cancels orders that never started checkout).
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

  if v_attempt > 1 then o_tx_ref := o_tx_ref || '-' || v_attempt; end if;
  o_amount_cents := v_amount;
  o_currency := v_currency;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- apply_flutterwave_payment: same as 003 plus the grp_<uuid> branch.
-- ---------------------------------------------------------------------------
create or replace function public.apply_flutterwave_payment(
  p_tx_ref text, p_provider_ref text, p_amount_cents integer, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_uuid   constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_m      text[];
  v_order  public.orders;
  v_member public.pool_members;
  v_pool   public.trend_pools;
  v_group  public.checkout_groups;
  v_due    integer;
begin
  v_m := regexp_match(lower(p_tx_ref), '^ord_(' || v_uuid || ')(-[0-9]+)?$');
  if v_m is not null then
    select * into v_order from public.orders where id = v_m[1]::uuid for update;
    if not found then return 'unknown_reference'; end if;
    if v_order.escrow_status <> 'pending_payment' then return 'already_processed'; end if;
    if upper(p_currency) <> v_order.currency then return 'currency_mismatch'; end if;
    if p_amount_cents < v_order.total_cents then return 'amount_mismatch'; end if;
    update public.orders
       set escrow_status = 'funded', payment_provider = 'flutterwave', payment_ref = p_provider_ref, funded_at = now()
     where id = v_order.id;
    return 'order_funded';
  end if;

  v_m := regexp_match(lower(p_tx_ref), '^pool_(' || v_uuid || ')_(' || v_uuid || ')(-[0-9]+)?$');
  if v_m is not null then
    select * into v_member from public.pool_members
     where pool_id = v_m[1]::uuid and buyer_id = v_m[2]::uuid for update;
    if not found then return 'unknown_reference'; end if;
    if v_member.payment_status not in ('pending_payment', 'cancelled') then return 'already_processed'; end if;
    if upper(p_currency) <> 'USD' then return 'currency_mismatch'; end if;
    if p_amount_cents < v_member.contribution_cents then return 'amount_mismatch'; end if;

    select * into v_pool from public.trend_pools where id = v_member.pool_id;
    update public.pool_members
       set payment_status = 'funded', payment_ref = p_provider_ref, paid_at = now(),
           refund_status = case when v_pool.status in ('expired', 'cancelled') then 'pending' else refund_status end
     where pool_id = v_member.pool_id and buyer_id = v_member.buyer_id;
    return case when v_pool.status in ('expired', 'cancelled') then 'pledge_funded_refund_queued' else 'pledge_funded' end;
  end if;

  v_m := regexp_match(lower(p_tx_ref), '^grp_(' || v_uuid || ')(-[0-9]+)?$');
  if v_m is not null then
    select * into v_group from public.checkout_groups where id = v_m[1]::uuid for update;
    if not found then return 'unknown_reference'; end if;
    perform 1 from public.orders where checkout_group_id = v_group.id and escrow_status = 'pending_payment' for update;
    select coalesce(sum(total_cents), 0) into v_due
      from public.orders where checkout_group_id = v_group.id and escrow_status = 'pending_payment';
    if v_due = 0 then return 'already_processed'; end if;
    if upper(p_currency) <> 'USD' then return 'currency_mismatch'; end if;
    if p_amount_cents < v_due then return 'amount_mismatch'; end if;
    -- orders.payment_ref is unique: suffix the shared provider reference per order.
    update public.orders
       set escrow_status = 'funded', payment_provider = 'flutterwave',
           payment_ref = p_provider_ref || ':' || id, funded_at = now()
     where checkout_group_id = v_group.id and escrow_status = 'pending_payment';
    update public.checkout_groups
       set payment_provider = 'flutterwave', payment_ref = p_provider_ref, funded_at = now()
     where id = v_group.id;
    return 'group_funded';
  end if;

  return 'unknown_reference';
end $$;

-- ---------------------------------------------------------------------------
-- M-Pesa for a checkout group: same rules as begin_mpesa_payment().
-- ---------------------------------------------------------------------------
create or replace function public.begin_mpesa_group_payment(
  p_group_id uuid, p_buyer_id uuid, p_phone text, p_kes_per_usd numeric, p_max_kes integer
) returns public.mpesa_payments language plpgsql security definer set search_path = public as $$
declare
  v_total   integer;
  v_count   integer;
  v_kes     integer;
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

  v_kes := ceil(v_total * p_kes_per_usd / 100.0)::integer;
  if v_kes > p_max_kes then
    raise exception 'This checkout is KES % — above the M-Pesa limit of KES % per transaction. Remove some items or pay by card.',
      to_char(v_kes, 'FM999,999,990'), to_char(p_max_kes, 'FM999,999,990');
  end if;

  insert into public.mpesa_payments (checkout_group_id, buyer_id, phone, usd_cents, kes_per_usd, amount_kes)
  values (p_group_id, p_buyer_id, p_phone, v_total, p_kes_per_usd, v_kes)
  returning * into v_payment;
  return v_payment;
end $$;

-- ---------------------------------------------------------------------------
-- apply_mpesa_payment: same as 007 plus checkout groups.
-- ---------------------------------------------------------------------------
create or replace function public.apply_mpesa_payment(
  p_checkout_request_id text, p_result_code integer, p_result_desc text, p_receipt text, p_amount_kes integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.mpesa_payments;
  v_order public.orders;
  v_due   integer;
  v_ref   text;
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
  if v_order.escrow_status <> 'pending_payment' then
    -- Paid twice (e.g. card + M-Pesa) or the order was cancelled meanwhile.
    update public.mpesa_payments
       set status = 'review', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
           completed_at = now(),
           review_reason = format('Order was already %s when this M-Pesa payment completed — refund the buyer', v_order.escrow_status)
     where id = v_pay.id;
    return 'duplicate_payment';
  end if;

  update public.mpesa_payments
     set status = 'succeeded', result_code = 0, result_desc = left(p_result_desc, 500), mpesa_receipt = p_receipt,
         completed_at = now()
   where id = v_pay.id;
  update public.orders
     set escrow_status = 'funded', payment_provider = 'mpesa', payment_ref = v_ref, funded_at = now()
   where id = v_pay.order_id;
  return 'order_funded';
end $$;

-- ---------------------------------------------------------------------------
-- Ops alerts: same as 007; M-Pesa references now name the order or the cart.
-- ---------------------------------------------------------------------------
create or replace function public.pending_ops_alerts(p_realert_after interval default interval '24 hours')
returns table (key text, kind text, reference text, detail text, amount_cents bigint, currency text, first_seen_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_keys text[];
begin
  create temporary table if not exists _ops_items (key text, kind text, reference text, detail text, amount_cents bigint, currency text) on commit drop;
  truncate _ops_items;

  insert into _ops_items
  select 'payout_missing_transfer_id:' || p.reference, 'payout_missing_transfer_id', p.reference,
         'Transfer request outcome unknown (timeout/5xx) — check Flutterwave by reference before retrying',
         p.amount_cents, p.currency::text
    from public.payouts p where p.status = 'processing' and p.flw_transfer_id is null and p.updated_at < now() - interval '1 hour'
  union all
  select 'payout_no_webhook:' || p.reference, 'payout_no_webhook', p.reference || ' · transfer ' || p.flw_transfer_id,
         'Transfer sent but no completion webhook after 48h', p.amount_cents, p.currency::text
    from public.payouts p where p.status = 'processing' and p.flw_transfer_id is not null and p.updated_at < now() - interval '48 hours'
  union all
  select 'payout_failed_final:' || p.order_id, 'payout_failed_final', p.reference,
         coalesce(p.failure_reason, 'Failed after 5 attempts'), p.amount_cents, p.currency::text
    from public.payouts p where (p.status = 'failed' and p.attempts >= 5)
                             or (p.status = 'on_hold' and p.failure_reason like 'Max payout attempts%')
  union all
  select 'payout_on_hold_long:' || p.order_id, 'payout_on_hold_long', p.reference,
         coalesce(p.failure_reason, 'On hold'), p.amount_cents, p.currency::text
    from public.payouts p where p.status = 'on_hold' and coalesce(p.failure_reason, '') not like 'Max payout attempts%'
                            and p.updated_at < now() - interval '72 hours'
  union all
  select 'refund_failed_final:' || m.pool_id || ':' || m.buyer_id, 'refund_failed_final',
         'pool_' || m.pool_id || '_' || m.buyer_id || ' · txn ' || coalesce(m.payment_ref, '?'),
         coalesce(m.refund_error, 'Refund failed 5 times'), m.contribution_cents::bigint, 'USD'
    from public.pool_members m where m.refund_status = 'failed'
  union all
  select 'refund_stuck:' || m.pool_id || ':' || m.buyer_id, 'refund_stuck',
         'pool_' || m.pool_id || '_' || m.buyer_id || ' · txn ' || coalesce(m.payment_ref, '?'),
         'Refund claimed >30 min ago without a result', m.contribution_cents::bigint, 'USD'
    from public.pool_members m where m.refund_status = 'processing' and m.refund_claimed_at < now() - interval '30 minutes'
  union all
  select 'payment_mismatch:' || e.event_id, 'payment_mismatch', coalesce(e.tx_ref, e.event_id),
         'Webhook outcome: ' || e.outcome, null::bigint, null
    from public.payment_events e
   where e.outcome in ('amount_mismatch', 'currency_mismatch', 'unknown_reference', 'verification_mismatch')
     and e.received_at > now() - interval '7 days'
  union all
  select 'mpesa_review:' || mp.id, 'mpesa_review',
         'M-Pesa ' || coalesce(mp.mpesa_receipt, mp.checkout_request_id) || ' · '
           || coalesce('order ' || mp.order_id, 'cart ' || mp.checkout_group_id),
         coalesce(mp.review_reason, 'Needs review') || ' (KES ' || mp.amount_kes || ', ' || mp.phone || ')',
         mp.usd_cents::bigint, 'USD'
    from public.mpesa_payments mp where mp.status = 'review'
  union all
  select 'mpesa_unresolved:' || mp.id, 'mpesa_unresolved',
         'M-Pesa ' || coalesce(mp.checkout_request_id, 'no checkout id') || ' · '
           || coalesce('order ' || mp.order_id, 'cart ' || mp.checkout_group_id),
         'STK payment still unresolved after 1h — check the Daraja portal / M-Pesa statement',
         mp.usd_cents::bigint, 'USD'
    from public.mpesa_payments mp
   where mp.status = 'pending' and mp.created_at < now() - interval '1 hour';

  select array_agg(i.key) into v_keys from _ops_items i;

  insert into public.ops_alerts as a (key, kind, reference, detail, amount_cents, currency)
  select i.key, i.kind, i.reference, i.detail, i.amount_cents, i.currency from _ops_items i
  on conflict (key) do update
    set last_seen_at = now(), resolved_at = null, detail = excluded.detail, reference = excluded.reference;

  update public.ops_alerts set resolved_at = now()
   where resolved_at is null and (v_keys is null or not (ops_alerts.key = any (v_keys)));

  return query
    select a.key, a.kind, a.reference, a.detail, a.amount_cents, a.currency, a.first_seen_at
      from public.ops_alerts a
     where a.resolved_at is null
       and (a.last_alerted_at is null or a.last_alerted_at < now() - p_realert_after)
     order by a.kind, a.first_seen_at;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'begin_payment_attempt(text, uuid, uuid)', 'apply_flutterwave_payment(text, text, integer, text)',
    'begin_mpesa_group_payment(uuid, uuid, text, numeric, integer)',
    'apply_mpesa_payment(text, integer, text, text, integer)', 'pending_ops_alerts(interval)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  execute 'revoke execute on function public.create_cart_checkout(uuid[]) from public, anon';
  execute 'grant execute on function public.create_cart_checkout(uuid[]) to authenticated';
end $$;
