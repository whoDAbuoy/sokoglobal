-- =============================================================================
-- SokoGlobal — Migration 007: M-Pesa (Safaricom Daraja STK Push) for Trial
-- Batch orders. Run after 006. Re-runnable.
--
-- Escrow stays in USD. The buyer pays the order total converted to KES at the
-- platform rate (MPESA_KES_PER_USD), rounded UP to the shilling. Rate and KES
-- amount are frozen on the payment row when the prompt is sent.
--
-- Trend Pool pledges stay on Flutterwave: their automatic refunds go through
-- Flutterwave, and refunding M-Pesa needs Safaricom's Reversal API.
--
-- Flow (service_role only):
--   begin_mpesa_payment()  → row 'initiating' (+ order.payment_attempts++)
--   app calls STK Push     → row 'pending' with checkout_request_id
--   STK Query result       → apply_mpesa_payment() → order 'funded' | row failed/cancelled/review
-- =============================================================================

create table if not exists public.mpesa_payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete restrict,
  buyer_id            uuid not null references public.profiles (id) on delete restrict,
  phone               text not null check (phone ~ '^254[17][0-9]{8}$'),
  usd_cents           integer not null check (usd_cents > 0),
  kes_per_usd         numeric(10, 4) not null check (kes_per_usd > 0),
  amount_kes          integer not null check (amount_kes > 0),
  status              text not null default 'initiating'
                        check (status in ('initiating', 'pending', 'succeeded', 'failed', 'cancelled', 'review')),
  checkout_request_id text unique,
  merchant_request_id text,
  result_code         integer,
  result_desc         text,
  mpesa_receipt       text unique,
  callback_payload    jsonb,          -- last Daraja callback; receipt/amount are taken from it once STK Query confirms
  review_reason       text,           -- set with status 'review' (needs a human: refund / investigate)
  last_queried_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists mpesa_payments_order_idx on public.mpesa_payments (order_id, created_at desc);
create index if not exists mpesa_payments_buyer_idx on public.mpesa_payments (buyer_id);
create index if not exists mpesa_payments_open_idx on public.mpesa_payments (created_at) where status in ('initiating', 'pending');

drop trigger if exists mpesa_payments_touch on public.mpesa_payments;
create trigger mpesa_payments_touch before update on public.mpesa_payments
  for each row execute function public.touch_updated_at();

alter table public.mpesa_payments enable row level security;
drop policy if exists "mpesa: buyer reads own" on public.mpesa_payments;
drop policy if exists "mpesa: admin reads"     on public.mpesa_payments;
create policy "mpesa: buyer reads own" on public.mpesa_payments for select using (buyer_id = (select auth.uid()));
create policy "mpesa: admin reads" on public.mpesa_payments for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.mpesa_payments from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Start an attempt. Amount comes from the order row, never from the client.
-- ---------------------------------------------------------------------------
create or replace function public.begin_mpesa_payment(
  p_order_id uuid, p_buyer_id uuid, p_phone text, p_kes_per_usd numeric, p_max_kes integer
) returns public.mpesa_payments language plpgsql security definer set search_path = public as $$
declare
  v_total    integer;
  v_currency text;
  v_kes      integer;
  v_payment  public.mpesa_payments;
begin
  if p_kes_per_usd is null or p_kes_per_usd < 50 or p_kes_per_usd > 500 then
    raise exception 'M-Pesa exchange rate is not configured correctly';
  end if;

  -- Locks the order row, so concurrent attempts for one order run one at a time.
  update public.orders o
     set payment_attempts = o.payment_attempts + 1
   where o.id = p_order_id and o.buyer_id = p_buyer_id and o.escrow_status = 'pending_payment'
  returning o.total_cents, o.currency into v_total, v_currency;
  if not found then raise exception 'Order is not awaiting payment'; end if;
  if v_currency <> 'USD' then raise exception 'Unsupported order currency %', v_currency; end if;

  -- One live prompt per order: a second push while the first is still on the
  -- buyer's phone could charge them twice. Prompts expire after ~1 minute.
  if exists (select 1 from public.mpesa_payments
              where order_id = p_order_id and status in ('initiating', 'pending')
                and created_at > now() - interval '2 minutes') then
    raise exception 'An M-Pesa prompt was already sent for this order. Check your phone, or try again in 2 minutes.';
  end if;

  v_kes := ceil(v_total * p_kes_per_usd / 100.0)::integer;
  if v_kes > p_max_kes then
    raise exception 'This order is KES % — above the M-Pesa limit of KES % per transaction. Please pay by card.',
      to_char(v_kes, 'FM999,999,990'), to_char(p_max_kes, 'FM999,999,990');
  end if;

  insert into public.mpesa_payments (order_id, buyer_id, phone, usd_cents, kes_per_usd, amount_kes)
  values (p_order_id, p_buyer_id, p_phone, v_total, p_kes_per_usd, v_kes)
  returning * into v_payment;
  return v_payment;
end $$;

-- ---------------------------------------------------------------------------
-- Settle a confirmed result. Returns an outcome code; never raises for
-- business mismatches (they become status 'review' + an ops alert).
-- ---------------------------------------------------------------------------
create or replace function public.apply_mpesa_payment(
  p_checkout_request_id text, p_result_code integer, p_result_desc text, p_receipt text, p_amount_kes integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pay   public.mpesa_payments;
  v_order public.orders;
begin
  select * into v_pay from public.mpesa_payments where checkout_request_id = p_checkout_request_id for update;
  if not found then return 'unknown_reference'; end if;

  if v_pay.status not in ('initiating', 'pending') then
    -- Settled from STK Query before the callback brought the receipt: fill it in.
    if v_pay.status = 'succeeded' and v_pay.mpesa_receipt is null and p_receipt is not null then
      update public.mpesa_payments set mpesa_receipt = p_receipt where id = v_pay.id;
      update public.orders set payment_ref = p_receipt
       where id = v_pay.order_id and payment_ref = 'mpesa:' || p_checkout_request_id;
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
     set escrow_status = 'funded', payment_provider = 'mpesa',
         payment_ref = coalesce(p_receipt, 'mpesa:' || p_checkout_request_id), funded_at = now()
   where id = v_pay.order_id;
  return 'order_funded';
end $$;

-- ---------------------------------------------------------------------------
-- Ops alerts: same as 004, plus M-Pesa payments needing a human.
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
         'M-Pesa ' || coalesce(mp.mpesa_receipt, mp.checkout_request_id) || ' · order ' || mp.order_id,
         coalesce(mp.review_reason, 'Needs review') || ' (KES ' || mp.amount_kes || ', ' || mp.phone || ')',
         mp.usd_cents::bigint, 'USD'
    from public.mpesa_payments mp where mp.status = 'review'
  union all
  select 'mpesa_unresolved:' || mp.id, 'mpesa_unresolved',
         'M-Pesa ' || coalesce(mp.checkout_request_id, 'no checkout id') || ' · order ' || mp.order_id,
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
-- Grants: service_role only (called from route handlers via the admin client).
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'begin_mpesa_payment(uuid, uuid, text, numeric, integer)',
    'apply_mpesa_payment(text, integer, text, text, integer)',
    'pending_ops_alerts(interval)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
