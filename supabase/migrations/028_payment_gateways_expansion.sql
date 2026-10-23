-- =============================================================================
-- SokoGlobal — Migration 028: more ways to pay — DPO Pay, Airtel Money, PayPal,
-- SWIFT wire transfers and crypto (USDT / USDC). Run after 027. Re-runnable.
--
--  * platform_settings (014 / 026) gains a switch per method, the SWIFT bank
--    details and crypto deposit wallets shown to buyers, and the crypto
--    handling fee. Everyone can read them (buyers see the details anyway); only
--    super_set_payment_settings() writes them (super admins, validated, audited).
--  * Online gateways (DPO Pay, PayPal, Airtel Money) reuse card_payments, which
--    already has a provider column: begin_gateway_payment() freezes the amount
--    (begin_payment_attempt: full total, milestone deposit or balance, or a
--    cart) exactly like Paystack, and apply_card_payment() funds escrow after
--    the app has verified the charge with the gateway's own API. gateway_token
--    holds the DPO TransToken / PayPal order id / Airtel transaction id.
--  * SWIFT and crypto are manual: manual_payments holds one transfer per order
--    leg (what to pay, where, a unique reference, then the buyer's receipt or
--    transaction hash). A super admin approves it against what actually arrived
--    (approve_manual_payment, service role only: like every funding path, money
--    moves into escrow only from the server) or rejects it with a note.
--    Single orders only; carts pay online. Crypto adds crypto_markup_percent.
--  * orders.payment_method (card, mpesa, airtel_money, dpo_pay, paypal,
--    swift_wire, crypto_usdt, crypto_usdc) follows payment_provider;
--    orders.payment_metadata records how a manual payment was verified.
--  * Unpaid orders with a wire or crypto transfer in progress are not expired
--    after 24 h (transfers take days); they get 14 days.
-- =============================================================================

-- ── 1. Settings ─────────────────────────────────────────────────────────────
alter table public.platform_settings
  add column if not exists enable_dpo_pay         boolean not null default true,
  add column if not exists enable_airtel_money    boolean not null default true,
  add column if not exists enable_paypal          boolean not null default true,
  add column if not exists enable_swift_wire      boolean not null default true,
  add column if not exists enable_crypto          boolean not null default false,
  add column if not exists swift_bank_details     jsonb not null
    default '{"bank_name": "", "swift_code": "", "account_number": "", "account_name": "", "routing_number": ""}'::jsonb,
  add column if not exists crypto_deposit_wallets jsonb not null
    default '{"usdt_trc20": "", "usdt_erc20": "", "usdc_polygon": ""}'::jsonb,
  add column if not exists crypto_markup_percent  numeric(6, 4) not null default 0.01,
  add column if not exists payments_updated_at    timestamptz;
do $$ begin
  alter table public.platform_settings add constraint platform_payments_valid check (
    crypto_markup_percent between 0 and 0.05
    and jsonb_typeof(swift_bank_details) = 'object' and jsonb_typeof(crypto_deposit_wallets) = 'object');
exception when duplicate_object then null; end $$;

create or replace function public.swift_details_complete(p jsonb)
returns boolean language sql immutable as $$
  select coalesce(btrim(p ->> 'bank_name'), '') <> '' and coalesce(btrim(p ->> 'swift_code'), '') <> ''
     and coalesce(btrim(p ->> 'account_number'), '') <> '' and coalesce(btrim(p ->> 'account_name'), '') <> ''
$$;

-- p: any of enable_dpo_pay, enable_airtel_money, enable_paypal, enable_swift_wire, enable_crypto (booleans),
-- swift_bank_details {bank_name, swift_code, account_number, account_name, routing_number, bank_address},
-- crypto_deposit_wallets {usdt_trc20, usdt_erc20, usdc_polygon}, crypto_markup_percent (fraction, ≤ 0.05).
create or replace function public.super_set_payment_settings(p jsonb, p_ip text default null, p_ua text default null)
returns public.platform_settings language plpgsql security definer set search_path = public as $$
declare
  v_old public.platform_settings; v public.platform_settings;
  k text; s text; b jsonb; w jsonb;
  c_flags constant text[] := array['enable_dpo_pay', 'enable_airtel_money', 'enable_paypal', 'enable_swift_wire', 'enable_crypto'];
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings must be a JSON object'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any (c_flags) then
      if jsonb_typeof(p -> k) <> 'boolean' then raise exception '% must be true or false', k; end if;
    elsif k not in ('swift_bank_details', 'crypto_deposit_wallets', 'crypto_markup_percent') then
      raise exception 'Unknown payment setting %', k;
    end if;
  end loop;
  select * into v_old from public.platform_settings where id for update;
  if not found then raise exception 'Platform settings row is missing (run migration 014)'; end if;

  b := v_old.swift_bank_details;
  if p ? 'swift_bank_details' then
    if jsonb_typeof(p -> 'swift_bank_details') <> 'object' then raise exception 'Bank details must be an object'; end if;
    for k in select jsonb_object_keys(p -> 'swift_bank_details') loop
      if k not in ('bank_name', 'swift_code', 'account_number', 'account_name', 'routing_number', 'bank_address') then raise exception 'Unknown bank field %', k; end if;
      if jsonb_typeof(p -> 'swift_bank_details' -> k) <> 'string' then raise exception '% must be text', replace(k, '_', ' '); end if;
      s := btrim(p -> 'swift_bank_details' ->> k);
      if char_length(s) > (case when k = 'bank_address' then 300 else 120 end) then raise exception '% is too long', replace(k, '_', ' '); end if;
      if k = 'swift_code' then s := upper(s); end if;
      if k = 'swift_code' and s <> '' and s !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then raise exception 'SWIFT/BIC must be 8 or 11 letters and digits'; end if;
      if k = 'account_number' and s <> '' and s !~ '^[A-Za-z0-9 -]{4,40}$' then raise exception 'Account number / IBAN: 4–40 letters, digits, spaces or dashes'; end if;
      if k = 'routing_number' and s <> '' and s !~ '^[A-Za-z0-9 -]{3,20}$' then raise exception 'Routing / sort code: 3–20 letters or digits'; end if;
      b := b || jsonb_build_object(k, s);
    end loop;
  end if;

  w := v_old.crypto_deposit_wallets;
  if p ? 'crypto_deposit_wallets' then
    if jsonb_typeof(p -> 'crypto_deposit_wallets') <> 'object' then raise exception 'Wallets must be an object'; end if;
    for k in select jsonb_object_keys(p -> 'crypto_deposit_wallets') loop
      if k not in ('usdt_trc20', 'usdt_erc20', 'usdc_polygon') then raise exception 'Unknown wallet %', k; end if;
      if jsonb_typeof(p -> 'crypto_deposit_wallets' -> k) <> 'string' then raise exception '% must be text', k; end if;
      s := btrim(p -> 'crypto_deposit_wallets' ->> k);
      if k = 'usdt_trc20' and s <> '' and s !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception 'TRC-20 address must start with T and be 34 characters'; end if;
      if k <> 'usdt_trc20' and s <> '' and s !~ '^0x[0-9a-fA-F]{40}$' then raise exception '% address must be 0x followed by 40 hex characters', upper(split_part(k, '_', 2)); end if;
      w := w || jsonb_build_object(k, s);
    end loop;
  end if;

  if p ? 'crypto_markup_percent' then
    if jsonb_typeof(p -> 'crypto_markup_percent') <> 'number' then raise exception 'Crypto fee must be a number'; end if;
    if (p ->> 'crypto_markup_percent')::numeric not between 0 and 0.05
       or (p ->> 'crypto_markup_percent')::numeric <> round((p ->> 'crypto_markup_percent')::numeric, 4) then
      raise exception 'Crypto fee must be between 0%% and 5%% (at most two decimals)';
    end if;
  end if;

  update public.platform_settings
     set enable_dpo_pay        = coalesce((p ->> 'enable_dpo_pay')::boolean, enable_dpo_pay),
         enable_airtel_money   = coalesce((p ->> 'enable_airtel_money')::boolean, enable_airtel_money),
         enable_paypal         = coalesce((p ->> 'enable_paypal')::boolean, enable_paypal),
         enable_swift_wire     = coalesce((p ->> 'enable_swift_wire')::boolean, enable_swift_wire),
         enable_crypto         = coalesce((p ->> 'enable_crypto')::boolean, enable_crypto),
         swift_bank_details    = b,
         crypto_deposit_wallets = w,
         crypto_markup_percent = coalesce((p ->> 'crypto_markup_percent')::numeric, crypto_markup_percent),
         payments_updated_at = now(), updated_at = now()
   where id returning * into v;
  perform public.write_admin_audit('platform.payments', 'platform', 'payments', jsonb_build_object(
    'from', jsonb_build_object('flags', jsonb_build_array(v_old.enable_dpo_pay, v_old.enable_airtel_money, v_old.enable_paypal, v_old.enable_swift_wire, v_old.enable_crypto),
                               'swift_bank_details', v_old.swift_bank_details, 'crypto_deposit_wallets', v_old.crypto_deposit_wallets, 'crypto_markup_percent', v_old.crypto_markup_percent),
    'to', jsonb_build_object('flags', jsonb_build_array(v.enable_dpo_pay, v.enable_airtel_money, v.enable_paypal, v.enable_swift_wire, v.enable_crypto),
                             'swift_bank_details', v.swift_bank_details, 'crypto_deposit_wallets', v.crypto_deposit_wallets, 'crypto_markup_percent', v.crypto_markup_percent)),
    p_ip, p_ua);
  return v;
end $$;

-- ── 2. Orders: how they were paid ───────────────────────────────────────────
alter table public.orders add column if not exists payment_method   text;
alter table public.orders add column if not exists payment_metadata jsonb;
do $$ begin
  alter table public.orders add constraint orders_payment_method_valid check (payment_method is null or payment_method in
    ('card', 'mpesa', 'airtel_money', 'dpo_pay', 'paypal', 'swift_wire', 'crypto_usdt', 'crypto_usdc'));
exception when duplicate_object then null; end $$;

create or replace function public.payment_method_for(p_provider text)
returns text language sql immutable as $$
  select case p_provider
    when 'paystack' then 'card' when 'flutterwave' then 'card' when 'mpesa' then 'mpesa'
    when 'dpo' then 'dpo_pay' when 'paypal' then 'paypal' when 'airtel_money' then 'airtel_money'
    when 'swift_wire' then 'swift_wire' when 'crypto_usdt' then 'crypto_usdt' when 'crypto_usdc' then 'crypto_usdc'
  end
$$;
create or replace function public.orders_payment_method()
returns trigger language plpgsql as $$
begin
  new.payment_method := coalesce(public.payment_method_for(new.payment_provider), new.payment_method);
  return new;
end $$;
drop trigger if exists orders_payment_method on public.orders;
create trigger orders_payment_method before insert or update of payment_provider on public.orders
  for each row execute function public.orders_payment_method();
update public.orders set payment_method = public.payment_method_for(payment_provider)
 where payment_provider is not null and payment_method is distinct from public.payment_method_for(payment_provider)
   and public.payment_method_for(payment_provider) is not null;

-- ── 3. Online gateways on card_payments ─────────────────────────────────────
alter table public.card_payments add column if not exists gateway_token text;
alter table public.card_payments add column if not exists phone         text;
create unique index if not exists card_payments_gateway_token_uniq on public.card_payments (provider, gateway_token) where gateway_token is not null;
create index if not exists card_payments_open_gateway_idx on public.card_payments (provider, created_at) where status = 'initiated' and provider <> 'paystack';
do $$ begin
  alter table public.card_payments add constraint card_payments_provider_valid check (provider in ('paystack', 'dpo', 'paypal', 'airtel_money'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- Gateways other than Paystack only take order / cart payments (pledges and platform purchases stay on Paystack).
  alter table public.card_payments add constraint card_payments_gateway_kinds check (provider = 'paystack' or kind in ('order', 'group'));
exception when duplicate_object then null; end $$;

create or replace function public.gateway_enabled(p_provider text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case p_provider when 'dpo' then enable_dpo_pay when 'paypal' then enable_paypal
                                          when 'airtel_money' then enable_airtel_money when 'paystack' then true end
                     from public.platform_settings where id), p_provider = 'paystack')
$$;

-- Same as begin_card_payment (amount from Postgres, FX spread on non-USD), for another gateway.
-- Airtel Money is charged in whole units of its currency, rounded up.
create or replace function public.begin_gateway_payment(
  p_provider text, p_kind text, p_ref_id uuid, p_buyer_id uuid, p_currency text, p_usd_rate numeric, p_phone text default null
) returns public.card_payments language plpgsql security definer set search_path = public as $$
declare v public.card_payments;
begin
  if p_provider not in ('dpo', 'paypal', 'airtel_money') then raise exception 'Unknown payment provider %', p_provider; end if;
  if p_kind not in ('order', 'group') then raise exception 'This payment method is for orders and cart checkouts'; end if;
  if not public.gateway_enabled(p_provider) then
    raise exception '% is turned off right now. Please choose another payment method.',
      case p_provider when 'dpo' then 'DPO Pay' when 'paypal' then 'PayPal' else 'Airtel Money' end using errcode = '55000';
  end if;
  if p_provider = 'airtel_money' then
    if p_phone is null or p_phone !~ '^[0-9]{10,13}$' then raise exception 'Enter your Airtel Money number'; end if;
    if exists (select 1 from public.card_payments c
                where c.provider = 'airtel_money' and c.status = 'initiated' and c.created_at > now() - interval '2 minutes'
                  and (c.order_id = p_ref_id or c.checkout_group_id = p_ref_id)) then
      raise exception 'An Airtel Money prompt was already sent. Check your phone, or try again in 2 minutes.';
    end if;
  end if;
  v := public.begin_card_payment(p_kind, p_ref_id, p_buyer_id, p_currency, p_usd_rate);
  update public.card_payments
     set provider = p_provider, phone = p_phone,
         amount_minor = case when p_provider = 'airtel_money' and currency <> 'USD' then ceil(amount_minor / 100.0)::bigint * 100 else amount_minor end,
         gateway_token = case when p_provider = 'airtel_money' then 'SG' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 18)) end
   where id = v.id returning * into v;
  return v;
end $$;

-- apply_card_payment: same as 026; the order / cart / pledge records the gateway that took the money.
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
      update public.orders set escrow_status = 'funded', payment_provider = v_pay.provider, payment_ref = p_provider_ref, funded_at = now()
       where id = v_order.id;
      v_outcome := 'order_funded';
    elsif v_order.escrow_status::text = 'pending_payment' and v_pay.leg = 'deposit' and v_order.payment_structure = 'milestone_30_70' then
      if v_pay.usd_cents <> v_order.deposit_amount then
        v_why := format('Deposit due was %s USD cents but this %s payment was for %s — reconcile or refund the buyer', v_order.deposit_amount, v_pay.provider, v_pay.usd_cents);
      else
        update public.orders set escrow_status = 'deposit_paid', deposit_paid_at = now(), funded_at = now(),
               payment_provider = v_pay.provider, payment_ref = p_provider_ref
         where id = v_order.id;
        v_outcome := 'deposit_funded';
      end if;
    elsif v_order.escrow_status::text = 'deposit_paid' and v_pay.leg = 'balance' and v_order.final_paid_at is null then
      if v_pay.usd_cents <> v_order.remaining_balance then
        v_why := format('Balance due was %s USD cents but this %s payment was for %s — reconcile or refund the buyer', v_order.remaining_balance, v_pay.provider, v_pay.usd_cents);
      else
        update public.orders set escrow_status = public.milestone_settled_status(current_status), final_paid_at = now(),
               delivered_at = case when current_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
         where id = v_order.id;
        v_outcome := 'balance_funded';
      end if;
    else
      v_why := format('Order was already %s when this %s payment (%s) completed — refund the buyer', v_order.escrow_status, v_pay.provider, coalesce(v_pay.leg, 'full amount'));
    end if;

  elsif v_pay.kind = 'group' then
    perform 1 from public.checkout_groups where id = v_pay.checkout_group_id for update;
    perform 1 from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment' for update;
    select coalesce(sum(total_cents), 0) into v_due
      from public.orders where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
    if v_due <> v_pay.usd_cents then
      v_why := format('Checkout had %s USD cents unpaid when this %s payment (for %s) completed — reconcile or refund the buyer', v_due, v_pay.provider, v_pay.usd_cents);
    else
      update public.orders
         set escrow_status = 'funded', payment_provider = v_pay.provider, payment_ref = p_provider_ref || ':' || id, funded_at = now()
       where checkout_group_id = v_pay.checkout_group_id and escrow_status = 'pending_payment';
      update public.checkout_groups set payment_provider = v_pay.provider, payment_ref = p_provider_ref, funded_at = now()
       where id = v_pay.checkout_group_id;
      v_outcome := 'group_funded';
    end if;

  elsif v_pay.kind = 'subscription' then
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
         set payment_status = 'funded', payment_ref = p_provider_ref, payment_provider = v_pay.provider, paid_at = now(),
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

-- ── 4. Manual payments: SWIFT wire and crypto ───────────────────────────────
create table if not exists public.manual_payments (
  id             uuid primary key default gen_random_uuid(),
  method         text not null check (method in ('swift_wire', 'crypto_usdt', 'crypto_usdc')),
  network        text check (network is null or network in ('trc20', 'erc20', 'polygon')),
  order_id       uuid not null references public.orders (id) on delete restrict,
  buyer_id       uuid not null references public.profiles (id) on delete restrict,
  leg            text check (leg is null or leg in ('deposit', 'balance')),
  usd_cents      integer not null check (usd_cents > 0),            -- what escrow receives for the order
  fee_cents      integer not null default 0 check (fee_cents >= 0), -- crypto handling fee
  charge_cents   integer generated always as (usd_cents + fee_cents) stored,
  reference      text not null unique,
  pay_to         jsonb not null,                                    -- bank details or {asset, network, address} as shown
  tx_hash        text,
  proof_path     text,                                              -- payment-proofs/<buyer>/<payment id>/<uuid>.<ext>
  status         text not null default 'awaiting' check (status in ('awaiting', 'submitted', 'approved', 'rejected', 'cancelled')),
  received_cents integer check (received_cents is null or received_cents > 0),
  review_note    text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint manual_payments_network_fits check (
    (method = 'swift_wire' and network is null)
    or (method = 'crypto_usdt' and network in ('trc20', 'erc20'))
    or (method = 'crypto_usdc' and network = 'polygon'))
);
create unique index if not exists manual_payments_one_open on public.manual_payments (order_id) where status in ('awaiting', 'submitted');
create unique index if not exists manual_payments_tx_uniq on public.manual_payments (network, lower(tx_hash)) where tx_hash is not null;
create index if not exists manual_payments_queue_idx on public.manual_payments (submitted_at) where status = 'submitted';
create index if not exists manual_payments_buyer_idx on public.manual_payments (buyer_id, created_at desc);
drop trigger if exists manual_payments_touch on public.manual_payments;
create trigger manual_payments_touch before update on public.manual_payments for each row execute function public.touch_updated_at();
drop trigger if exists manual_payments_not_frozen on public.manual_payments;
create trigger manual_payments_not_frozen before insert on public.manual_payments for each row execute function public.guard_not_frozen();

alter table public.manual_payments enable row level security;
drop policy if exists "manual_payments: buyer reads own" on public.manual_payments;
drop policy if exists "manual_payments: admin reads"     on public.manual_payments;
create policy "manual_payments: buyer reads own" on public.manual_payments for select to authenticated using (buyer_id = (select auth.uid()));
create policy "manual_payments: admin reads" on public.manual_payments for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.manual_payments from anon, authenticated;
grant select on public.manual_payments to authenticated;

-- Private bucket for wire receipts / crypto screenshots (admins view them through short-lived signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
drop policy if exists "payment proofs: buyer uploads own" on storage.objects;
drop policy if exists "payment proofs: buyer reads own"   on storage.objects;
drop policy if exists "payment proofs: admin reads"       on storage.objects;
create policy "payment proofs: buyer uploads own" on storage.objects for insert to authenticated with check (
  bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "payment proofs: buyer reads own" on storage.objects for select to authenticated using (
  bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "payment proofs: admin reads" on storage.objects for select to authenticated using (
  bucket_id = 'payment-proofs' and (select public.current_role_is('admin')));

-- Buyer starts a wire or crypto payment for what is due on a single order. Re-choosing the same method returns
-- the open request (same reference); choosing another one replaces it unless a transfer is already submitted.
create or replace function public.begin_manual_payment(p_order_id uuid, p_method text, p_network text default null)
returns public.manual_payments language plpgsql security definer set search_path = public as $$
declare
  v_s        public.platform_settings;
  v_order    public.orders;
  v_open     public.manual_payments;
  v_row      public.manual_payments;
  v_due      integer;
  v_leg      text;
  v_fee      integer := 0;
  v_addr     text;
  v_pay_to   jsonb;
begin
  if not public.current_role_is('importer') then raise exception 'Importer account required' using errcode = '42501'; end if;
  select * into v_s from public.platform_settings where id;
  if v_s.maintenance_mode or v_s.pause_checkout then
    raise exception 'Checkout is paused right now. Your order is saved; please try again later.' using errcode = '55000';
  end if;
  if p_method = 'swift_wire' then
    if not v_s.enable_swift_wire or not public.swift_details_complete(v_s.swift_bank_details) then
      raise exception 'Bank wire transfers are not available right now' using errcode = '55000';
    end if;
    if p_network is not null then raise exception 'Bank wires have no network'; end if;
    v_pay_to := v_s.swift_bank_details;
  elsif p_method in ('crypto_usdt', 'crypto_usdc') then
    if not v_s.enable_crypto then raise exception 'Crypto payments are not available right now' using errcode = '55000'; end if;
    if not ((p_method = 'crypto_usdt' and p_network in ('trc20', 'erc20')) or (p_method = 'crypto_usdc' and p_network = 'polygon')) then
      raise exception 'Choose a supported network (USDT on TRC-20 or ERC-20, USDC on Polygon)';
    end if;
    v_addr := btrim(coalesce(v_s.crypto_deposit_wallets ->> (case p_method when 'crypto_usdt' then 'usdt_' else 'usdc_' end || p_network), ''));
    if v_addr = '' then raise exception 'That network is not available right now' using errcode = '55000'; end if;
    v_pay_to := jsonb_build_object('asset', case p_method when 'crypto_usdt' then 'USDT' else 'USDC' end, 'network', p_network, 'address', v_addr);
  else
    raise exception 'Unknown payment method %', p_method;
  end if;

  select * into v_order from public.orders where id = p_order_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.checkout_group_id is not null then
    raise exception 'Cart checkouts are paid online (card, M-Pesa, Airtel Money, DPO Pay or PayPal)';
  end if;
  if v_order.escrow_status::text = 'deposit_paid' and v_order.final_paid_at is null and v_order.current_status = 'awaiting_dispatch' then
    raise exception 'The 70%% balance becomes payable once the supplier dispatches your order';
  end if;
  if not (v_order.escrow_status::text = 'pending_payment' or (v_order.escrow_status::text = 'deposit_paid' and v_order.final_paid_at is null)) then
    raise exception 'Order is not awaiting payment';
  end if;
  v_due := public.order_amount_due_cents(v_order);
  if v_due is null or v_due <= 0 then raise exception 'Nothing is due on this order right now'; end if;
  v_leg := case when v_order.escrow_status::text = 'deposit_paid' then 'balance' when v_order.payment_structure = 'milestone_30_70' then 'deposit' end;
  if p_method <> 'swift_wire' then v_fee := ceil(v_due * v_s.crypto_markup_percent)::integer; end if;

  select * into v_open from public.manual_payments where order_id = p_order_id and status in ('awaiting', 'submitted') for update;
  if found then
    if v_open.status = 'submitted' then
      raise exception 'Your transfer (reference %) is being verified. This order updates as soon as it is confirmed.', v_open.reference;
    end if;
    if v_open.method = p_method and v_open.network is not distinct from p_network and v_open.usd_cents = v_due
       and v_open.fee_cents = v_fee and v_open.leg is not distinct from v_leg and v_open.pay_to = v_pay_to then
      return v_open;
    end if;
    update public.manual_payments set status = 'cancelled' where id = v_open.id;
  end if;

  insert into public.manual_payments (method, network, order_id, buyer_id, leg, usd_cents, fee_cents, reference, pay_to)
  values (p_method, p_network, p_order_id, auth.uid(), v_leg, v_due, v_fee,
          case when p_method = 'swift_wire' then 'SGW-' else 'SGC-' end || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
          v_pay_to)
  returning * into v_row;
  return v_row;
end $$;

-- Buyer reports the transfer: a receipt for a wire (required), the transaction hash for crypto (screenshot optional).
create or replace function public.submit_manual_payment(p_id uuid, p_tx_hash text default null, p_proof_path text default null)
returns public.manual_payments language plpgsql security definer set search_path = public as $$
declare v public.manual_payments; v_hash text := nullif(btrim(coalesce(p_tx_hash, '')), '');
begin
  select * into v from public.manual_payments where id = p_id and buyer_id = auth.uid() for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v.status <> 'awaiting' then raise exception 'This transfer was already %', v.status; end if;
  if p_proof_path is not null then
    if p_proof_path !~ ('^' || auth.uid()::text || '/' || p_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png)$')
       or not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_proof_path) then
      raise exception 'Upload the receipt again';
    end if;
  end if;
  if v.method = 'swift_wire' then
    if p_proof_path is null then raise exception 'Upload the bank''s transfer confirmation (PDF or photo)'; end if;
    v_hash := null;
  else
    if v_hash is null then raise exception 'Enter the transaction hash'; end if;
    if v.network = 'trc20' and v_hash !~ '^(0x)?[0-9a-fA-F]{64}$' then raise exception 'Enter the TRON transaction hash (64 hex characters)'; end if;
    if v.network in ('erc20', 'polygon') and v_hash !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'Enter the transaction hash: 0x followed by 64 hex characters'; end if;
    v_hash := lower(regexp_replace(v_hash, '^0x', case when v.network = 'trc20' then '' else '0x' end));
    if exists (select 1 from public.manual_payments where network = v.network and lower(tx_hash) = v_hash and id <> p_id) then
      raise exception 'This transaction hash was already submitted';
    end if;
  end if;
  update public.manual_payments set status = 'submitted', tx_hash = v_hash, proof_path = p_proof_path, submitted_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

create or replace function public.cancel_manual_payment(p_id uuid)
returns public.manual_payments language plpgsql security definer set search_path = public as $$
declare v public.manual_payments;
begin
  update public.manual_payments set status = 'cancelled' where id = p_id and buyer_id = auth.uid() and status = 'awaiting' returning * into v;
  if not found then raise exception 'Only a transfer you have not submitted yet can be cancelled'; end if;
  return v;
end $$;

-- Super admin approves what arrived. Service role only (orders leave pending_payment only from the server, 018);
-- the app checks the session is a super admin with 2FA first and passes them as p_actor.
create or replace function public.approve_manual_payment(p_id uuid, p_received_cents integer, p_note text, p_actor uuid,
  p_ip text default null, p_ua text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.manual_payments; v_order public.orders; v_ref text; v_meta jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role::text = 'super_admin' and not coalesce(is_banned, false)) then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  select * into v from public.manual_payments where id = p_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v.status <> 'submitted' then raise exception 'Only submitted transfers can be approved (this one is %)', v.status; end if;
  if p_received_cents is null or p_received_cents < v.charge_cents then
    raise exception 'Received $% but $% is due. Reject it with a note, or ask the buyer to send the difference first.',
      to_char(coalesce(p_received_cents, 0) / 100.0, 'FM999G999G990D00'), to_char(v.charge_cents / 100.0, 'FM999G999G990D00');
  end if;

  select * into v_order from public.orders where id = v.order_id for update;
  v_ref := coalesce(v.tx_hash, v.reference);
  v_meta := jsonb_build_object('manual_payment_id', v.id, 'method', v.method, 'network', v.network, 'reference', v.reference,
                               'tx_hash', v.tx_hash, 'received_cents', p_received_cents, 'fee_cents', v.fee_cents, 'approved_by', p_actor);
  if v_order.escrow_status::text = 'pending_payment' and v.leg is null and v_order.payment_structure = 'full' then
    if v.usd_cents <> v_order.total_cents then raise exception 'The order total changed after this transfer was requested — reject it and ask the buyer to start again'; end if;
    update public.orders set escrow_status = 'funded', payment_provider = v.method, payment_ref = v_ref, funded_at = now(), payment_metadata = v_meta
     where id = v_order.id returning * into v_order;
  elsif v_order.escrow_status::text = 'pending_payment' and v.leg = 'deposit' and v_order.payment_structure = 'milestone_30_70' then
    if v.usd_cents <> v_order.deposit_amount then raise exception 'The deposit changed after this transfer was requested — reject it and ask the buyer to start again'; end if;
    update public.orders set escrow_status = 'deposit_paid', deposit_paid_at = now(), funded_at = now(), payment_provider = v.method,
           payment_ref = v_ref, payment_metadata = v_meta
     where id = v_order.id returning * into v_order;
  elsif v_order.escrow_status::text = 'deposit_paid' and v.leg = 'balance' and v_order.final_paid_at is null then
    if v.usd_cents <> v_order.remaining_balance then raise exception 'The balance changed after this transfer was requested — reject it and ask the buyer to start again'; end if;
    update public.orders set escrow_status = public.milestone_settled_status(current_status), final_paid_at = now(),
           delivered_at = case when current_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           payment_metadata = coalesce(payment_metadata, '{}'::jsonb) || jsonb_build_object('balance', v_meta)
     where id = v_order.id returning * into v_order;
  else
    raise exception 'Order is already % — reject this transfer and refund the buyer', replace(v_order.escrow_status::text, '_', ' ');
  end if;

  update public.manual_payments
     set status = 'approved', received_cents = p_received_cents, review_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         reviewed_by = p_actor, reviewed_at = now()
   where id = v.id;
  insert into public.admin_audit_logs (actor_id, actor_level, action, target_type, target_id, detail, ip, user_agent)
  values (p_actor, 'super', 'escrow.manual_payment_approved', 'order', v.order_id::text,
          v_meta - 'approved_by' || jsonb_build_object('charge_cents', v.charge_cents, 'note', p_note), left(p_ip, 64), left(p_ua, 400));
  return v_order;
end $$;

-- Super admin rejects a transfer (wrong amount, nothing arrived, bad receipt). The buyer is told why and can start again.
create or replace function public.reject_manual_payment(p_id uuid, p_note text, p_actor uuid, p_ip text default null, p_ua text default null)
returns public.manual_payments language plpgsql security definer set search_path = public as $$
declare v public.manual_payments; v_note text := left(btrim(coalesce(p_note, '')), 1000); v_title text;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role::text = 'super_admin' and not coalesce(is_banned, false)) then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;
  if char_length(v_note) < 5 then raise exception 'Tell the buyer why (5+ characters)'; end if;
  update public.manual_payments set status = 'rejected', review_note = v_note, reviewed_by = p_actor, reviewed_at = now()
   where id = p_id and status in ('awaiting', 'submitted') returning * into v;
  if not found then raise exception 'Only open transfers can be rejected'; end if;
  insert into public.admin_audit_logs (actor_id, actor_level, action, target_type, target_id, detail, ip, user_agent)
  values (p_actor, 'super', 'escrow.manual_payment_rejected', 'order', v.order_id::text,
          jsonb_build_object('manual_payment_id', v.id, 'method', v.method, 'reference', v.reference, 'tx_hash', v.tx_hash, 'note', v_note),
          left(p_ip, 64), left(p_ua, 400));
  select p.title into v_title from public.orders o join public.products p on p.id = o.product_id where o.id = v.order_id;
  begin
    perform public.enqueue_notification(v.buyer_id, 'payment.manual_rejected',
      jsonb_build_object('order_id', v.order_id, 'product_title', v_title, 'reference', v.reference, 'note', v_note,
                         'method', v.method, 'total_cents', v.charge_cents, 'currency', 'USD'),
      'manualrej:' || v.id);
  exception when others then
    raise warning 'manual payment rejection notice failed for %: %', v.id, sqlerrm;
  end;
  return v;
end $$;

-- Same as 020, but an order with a wire / crypto transfer in progress gets 14 days instead of 24 hours.
create or replace function public.expire_stale_unpaid_orders(p_max_age interval default interval '24 hours', p_limit integer default 500)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with stale as (
    select o.id from public.orders o
     where o.escrow_status = 'pending_payment'
       and o.created_at < now() - p_max_age
       -- A card / gateway or M-Pesa attempt started in the last hour may still complete.
       and not exists (select 1 from public.card_payments c
                        where c.status = 'initiated' and c.created_at > now() - interval '1 hour'
                          and (c.order_id = o.id or (o.checkout_group_id is not null and c.checkout_group_id = o.checkout_group_id)))
       and not exists (select 1 from public.mpesa_payments m
                        where m.status in ('initiating', 'pending') and m.created_at > now() - interval '1 hour'
                          and (m.order_id = o.id or (o.checkout_group_id is not null and m.checkout_group_id = o.checkout_group_id)))
       and not exists (select 1 from public.manual_payments mp
                        where mp.order_id = o.id and mp.status in ('awaiting', 'submitted') and mp.created_at > now() - interval '14 days')
     order by o.created_at
     limit greatest(p_limit, 1)
     for update of o skip locked
  )
  update public.orders o set escrow_status = 'cancelled', expired_at = now()
    from stale where o.id = stale.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 5. Revenue: same as 026, plus crypto handling fees and the manual review queue ──
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
    'escrow_fees_cents', (select coalesce(sum(escrow_fee_cents), 0) from public.orders
                           where funded_at >= v_since and escrow_status::text not in ('refunded', 'cancelled')),
    'logistics_markup_cents', (select coalesce(sum(logistics_markup_cents), 0) from public.orders
                                where funded_at >= v_since and escrow_status::text not in ('refunded', 'cancelled')),
    'fx_margin_cents', (select coalesce(sum(fx_margin_cents), 0) from public.card_payments where status = 'succeeded' and completed_at >= v_since)
                     + (select coalesce(sum(fx_margin_cents), 0) from public.mpesa_payments where status = 'succeeded' and completed_at >= v_since),
    'crypto_fees_cents', (select coalesce(sum(fee_cents), 0) from public.manual_payments where status = 'approved' and reviewed_at >= v_since),
    'commission_cents', (select coalesce(sum(fee_cents - early_payout_fee_cents), 0) from public.payouts
                          where status = 'succeeded' and completed_at >= v_since),
    'early_payout_fees_cents', (select coalesce(sum(early_payout_fee_cents), 0) from public.payouts
                                 where status = 'succeeded' and completed_at >= v_since),
    'active_gold_suppliers', (select count(*) from public.subscriptions
                               where plan_type = 'gold_supplier' and status = 'active' and current_period_end > now()),
    'early_payout_exposure_cents', (select coalesce(sum(p.amount_cents), 0) from public.payouts p join public.orders o on o.id = p.order_id
                                     where p.early and p.status in ('processing', 'succeeded') and o.escrow_status::text <> 'released'),
    'early_payouts_open', (select count(*) from public.payouts p join public.orders o on o.id = p.order_id
                            where p.early and p.status in ('processing', 'succeeded') and o.escrow_status::text <> 'released'),
    'white_glove_open', (select count(*) from public.rfqs where needs_white_glove and status in ('open', 'quoted') and expires_at > now()),
    'manual_payments_pending', (select count(*) from public.manual_payments where status = 'submitted'));
end $$;

-- ── 6. Grants ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.begin_gateway_payment(text, text, uuid, uuid, text, numeric, text)',
                           'public.apply_card_payment(text, text, bigint, text)',
                           'public.approve_manual_payment(uuid, integer, text, uuid, text, text)',
                           'public.reject_manual_payment(uuid, text, uuid, text, text)',
                           'public.expire_stale_unpaid_orders(interval, integer)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.super_set_payment_settings(jsonb, text, text)', 'public.begin_manual_payment(uuid, text, text)',
                           'public.submit_manual_payment(uuid, text, text)', 'public.cancel_manual_payment(uuid)',
                           'public.super_platform_revenue(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.gateway_enabled(text) to anon, authenticated;
grant execute on function public.swift_details_complete(jsonb) to anon, authenticated;
