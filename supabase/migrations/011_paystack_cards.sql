-- =============================================================================
-- SokoGlobal — Migration 011: buyer card payments via Paystack (replaces
-- Flutterwave checkout). Run after 010. Re-runnable.
--
-- Flutterwave stays for supplier payouts (transfers, FX) and for refunding
-- pledges that were paid through it. New card payments for orders, carts and
-- Trend Pool pledges go through Paystack:
--   begin_card_payment()  → card_payments row with the charge amount frozen
--   Paystack charge.success webhook / buyer return → verify with Paystack
--   apply_card_payment()  → funds the order / every unpaid order in a cart / the pledge
-- Paystack references only allow [A-Za-z0-9.=-], so tx_refs map ord_ → ord.,
-- grp_ → grp., pool_<p>_<b> → pool.<p>.<b>.
-- =============================================================================

create table if not exists public.card_payments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,
  provider          text not null default 'paystack',
  kind              text not null check (kind in ('order', 'group', 'pool')),
  order_id          uuid references public.orders (id) on delete restrict,
  checkout_group_id uuid references public.checkout_groups (id) on delete restrict,
  pool_id           uuid references public.trend_pools (id) on delete restrict,
  buyer_id          uuid not null references public.profiles (id) on delete restrict,
  usd_cents         integer not null check (usd_cents > 0),
  currency          text not null,
  usd_rate          numeric(12, 4) not null check (usd_rate > 0),
  amount_minor      bigint not null check (amount_minor > 0),   -- what Paystack must collect, in currency minor units
  status            text not null default 'initiated' check (status in ('initiated', 'succeeded', 'failed', 'review')),
  provider_ref      text unique,                                  -- Paystack transaction id
  review_reason     text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint card_payments_one_target check (
    (kind = 'order' and order_id is not null and checkout_group_id is null and pool_id is null) or
    (kind = 'group' and checkout_group_id is not null and order_id is null and pool_id is null) or
    (kind = 'pool'  and pool_id is not null and order_id is null and checkout_group_id is null))
);
create index if not exists card_payments_order_idx on public.card_payments (order_id) where order_id is not null;
create index if not exists card_payments_group_idx on public.card_payments (checkout_group_id) where checkout_group_id is not null;
create index if not exists card_payments_buyer_idx on public.card_payments (buyer_id, created_at desc);

alter table public.card_payments enable row level security;
drop policy if exists "card_payments: buyer reads own" on public.card_payments;
drop policy if exists "card_payments: admin reads"     on public.card_payments;
create policy "card_payments: buyer reads own" on public.card_payments for select using (buyer_id = (select auth.uid()));
create policy "card_payments: admin reads" on public.card_payments for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.card_payments from authenticated, anon;

-- Which processor took each pledge, so refunds go back through the same one (null = Flutterwave, pre-011).
alter table public.pool_members add column if not exists payment_provider text;

-- ---------------------------------------------------------------------------
-- Start an attempt. Reuses begin_payment_attempt() (amount from Postgres,
-- per-order payment of cart orders refused, attempts counted).
-- ---------------------------------------------------------------------------
create or replace function public.begin_card_payment(
  p_kind text, p_ref_id uuid, p_buyer_id uuid, p_currency text, p_usd_rate numeric
) returns public.card_payments language plpgsql security definer set search_path = public as $$
declare
  v_attempt  record;
  v_currency text := upper(coalesce(p_currency, 'USD'));
  v_rate     numeric := case when upper(coalesce(p_currency, 'USD')) = 'USD' then 1 else p_usd_rate end;
  v_payment  public.card_payments;
begin
  if v_rate is null or v_rate <= 0 then raise exception 'Card payment exchange rate is not configured correctly'; end if;
  select * into v_attempt from public.begin_payment_attempt(p_kind, p_ref_id, p_buyer_id);
  if v_attempt.o_currency <> 'USD' then raise exception 'Unsupported escrow currency %', v_attempt.o_currency; end if;

  insert into public.card_payments (reference, kind, order_id, checkout_group_id, pool_id, buyer_id,
                                    usd_cents, currency, usd_rate, amount_minor)
  values (replace(v_attempt.o_tx_ref, '_', '.'), p_kind,
          case when p_kind = 'order' then p_ref_id end,
          case when p_kind = 'group' then p_ref_id end,
          case when p_kind = 'pool'  then p_ref_id end,
          p_buyer_id, v_attempt.o_amount_cents, v_currency, v_rate,
          case when v_currency = 'USD' then v_attempt.o_amount_cents else ceil(v_attempt.o_amount_cents * v_rate)::bigint end)
  returning * into v_payment;
  return v_payment;
end $$;

-- ---------------------------------------------------------------------------
-- Settle a verified Paystack charge. Returns an outcome code; mismatches and
-- double payments become status 'review' (+ ops alert), never an exception.
-- ---------------------------------------------------------------------------
create or replace function public.apply_card_payment(
  p_reference text, p_provider_ref text, p_amount_minor bigint, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay    public.card_payments;
  v_order  public.orders;
  v_member public.pool_members;
  v_pool   public.trend_pools;
  v_due    integer;
  v_why    text;
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
    if v_order.escrow_status <> 'pending_payment' then
      v_why := format('Order was already %s when this card payment completed — refund the buyer', v_order.escrow_status);
    else
      update public.orders set escrow_status = 'funded', payment_provider = 'paystack', payment_ref = p_provider_ref, funded_at = now()
       where id = v_order.id;
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
    end if;
  end if;

  if v_why is not null then
    update public.card_payments set status = 'review', provider_ref = p_provider_ref, review_reason = v_why, completed_at = now() where id = v_pay.id;
    return 'duplicate_payment';
  end if;
  update public.card_payments set status = 'succeeded', provider_ref = p_provider_ref, completed_at = now() where id = v_pay.id;
  return case v_pay.kind
    when 'order' then 'order_funded'
    when 'group' then 'group_funded'
    else case when v_pool.status in ('expired', 'cancelled') then 'pledge_funded_refund_queued' else 'pledge_funded' end
  end;
end $$;

-- Paystack reported the charge as failed/abandoned: close the attempt (buyer can retry).
create or replace function public.fail_card_payment(p_reference text, p_reason text)
returns void language sql security definer set search_path = public as $$
  update public.card_payments set status = 'failed', review_reason = left(p_reason, 500), completed_at = now()
   where reference = p_reference and status = 'initiated';
$$;

-- ---------------------------------------------------------------------------
-- Pool refunds now report the processor, so the cron refunds through the one that charged.
-- (Return type changes, so the function is dropped and recreated.)
-- ---------------------------------------------------------------------------
drop function if exists public.claim_pool_refunds(integer);
create function public.claim_pool_refunds(p_limit integer default 25)
returns table (pool_id uuid, buyer_id uuid, transaction_id text, amount_cents integer, attempt integer, provider text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with batch as (
    select m.pool_id, m.buyer_id from public.pool_members m
     where m.refund_status = 'pending' and m.payment_ref is not null
     order by m.joined_at limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.pool_members m
     set refund_status = 'processing', refund_attempts = m.refund_attempts + 1, refund_claimed_at = now()
    from batch b
   where m.pool_id = b.pool_id and m.buyer_id = b.buyer_id
  returning m.pool_id, m.buyer_id, m.payment_ref, m.contribution_cents, m.refund_attempts, coalesce(m.payment_provider, 'flutterwave');
end $$;

-- ---------------------------------------------------------------------------
-- Ops alerts: same as 008 plus card payments needing review.
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
   where mp.status = 'pending' and mp.created_at < now() - interval '1 hour'
  union all
  select 'card_review:' || cp.id, 'card_review',
         'Card ' || coalesce(cp.provider_ref, cp.reference) || ' · ' || cp.kind || ' ' || coalesce(cp.order_id, cp.checkout_group_id, cp.pool_id)::text,
         coalesce(cp.review_reason, 'Needs review'), cp.usd_cents::bigint, 'USD'
    from public.card_payments cp where cp.status = 'review';

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

do $$
declare f text;
begin
  foreach f in array array[
    'begin_card_payment(text, uuid, uuid, text, numeric)', 'apply_card_payment(text, text, bigint, text)',
    'fail_card_payment(text, text)', 'claim_pool_refunds(integer)', 'pending_ops_alerts(interval)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
