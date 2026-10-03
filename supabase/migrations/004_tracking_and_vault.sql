-- =============================================================================
-- SokoGlobal — Migration 004: shipment tracking, Vault-encrypted payout
-- accounts, FX payouts, ops alerting. Run after 003. Re-runnable.
--
-- Encryption design
--   Supabase marks pgsodium Transparent Column Encryption as pending
--   deprecation and recommends Supabase Vault. So instead of TCE security
--   labels, each payout account number is stored as a Vault secret
--   (authenticated encryption, key managed by Supabase, never in the DB).
--   The table keeps only:
--     account_number_secret_id  → vault.secrets.id
--     account_last4             → for display
--     account_fingerprint       → HMAC-SHA256 (pgcrypto) with a Vault-held
--                                 key: detects changes & duplicate accounts
--                                 across suppliers without decrypting.
--   Plaintext is reachable only through SECURITY DEFINER functions:
--     begin_payout()                 (service_role — to send the transfer)
--     admin_reveal_payout_account()  (admin — every call is audit-logged)
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- =============================================================================
-- A. Vault-backed payout account numbers
-- =============================================================================

-- Fingerprint key lives in Vault, generated once.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sokoglobal_payout_fingerprint_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'sokoglobal_payout_fingerprint_key',
                                'HMAC key for supplier payout account fingerprints');
  end if;
end $$;

create or replace function public.payout_fingerprint(p_account_number text)
returns bytea language sql stable security definer set search_path = public, extensions as $$
  select case when p_account_number is null then null else
    extensions.hmac(upper(regexp_replace(p_account_number, '\s', '', 'g')),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'sokoglobal_payout_fingerprint_key'),
                    'sha256')
  end
$$;
revoke execute on function public.payout_fingerprint(text) from public, anon, authenticated;

alter table public.supplier_payout_accounts
  add column if not exists account_number_secret_id uuid,
  add column if not exists account_last4            text check (account_last4 ~ '^[A-Za-z0-9+]{1,4}$'),
  add column if not exists account_fingerprint      bytea;
create index if not exists payout_accounts_fingerprint_idx on public.supplier_payout_accounts (account_fingerprint);

-- Backfill: move every plaintext account number into Vault, then drop the column.
do $$
declare r record; v_secret uuid;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'supplier_payout_accounts' and column_name = 'account_number') then
    alter table public.supplier_payout_accounts disable trigger payout_account_guard;
    for r in execute 'select supplier_id, account_number from public.supplier_payout_accounts
                       where account_number is not null and account_number_secret_id is null' loop
      v_secret := vault.create_secret(r.account_number, 'payout_account:' || r.supplier_id,
                                      'SokoGlobal supplier payout account number');
      update public.supplier_payout_accounts
         set account_number_secret_id = v_secret,
             account_last4 = right(r.account_number, 4),
             account_fingerprint = public.payout_fingerprint(r.account_number)
       where supplier_id = r.supplier_id;
    end loop;
    alter table public.supplier_payout_accounts drop column account_number;
    alter table public.supplier_payout_accounts enable trigger payout_account_guard;
  end if;
end $$;

-- Change detection now compares the fingerprint, not plaintext.
create or replace function public.guard_payout_account_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT'
     or (new.method, new.country_code, new.currency, new.bank_code, new.account_fingerprint, new.beneficiary_name, new.international)
        is distinct from
        (old.method, old.country_code, old.currency, old.bank_code, old.account_fingerprint, old.beneficiary_name, old.international)
  then
    if not public.current_role_is('admin') then
      new.verified := false; new.verified_by := null; new.verified_at := null;
      update public.supplier_kyc set status = 'submitted', submitted_at = now(),
             review_notes = 'Payout account changed — re-verification required'
       where supplier_id = new.supplier_id and status = 'approved';
    end if;
  end if;
  return new;
end $$;

-- Don't leave orphaned secrets behind when an account row is deleted.
create or replace function public.purge_payout_secret()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.account_number_secret_id is not null then
    delete from vault.secrets where id = old.account_number_secret_id;
  end if;
  return old;
end $$;
drop trigger if exists payout_account_purge_secret on public.supplier_payout_accounts;
create trigger payout_account_purge_secret after delete on public.supplier_payout_accounts
  for each row execute function public.purge_payout_secret();

-- Direct writes are closed; suppliers go through upsert_payout_account().
drop policy if exists "payout_acct: supplier writes own" on public.supplier_payout_accounts;
drop policy if exists "payout_acct: supplier edits own"  on public.supplier_payout_accounts;
revoke insert, update, delete, select on public.supplier_payout_accounts from authenticated, anon;
grant select (supplier_id, method, country_code, currency, bank_code, bank_name, account_last4,
              beneficiary_name, international, verified, verified_at, updated_at)
  on public.supplier_payout_accounts to authenticated;   -- never secret id or fingerprint

create or replace function public.upsert_payout_account(
  p_method public.payout_method, p_country_code text, p_currency text, p_bank_code text, p_bank_name text,
  p_account_number text, p_beneficiary_name text, p_international jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing public.supplier_payout_accounts;
  v_num      text := nullif(upper(regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g')), '');
  v_name     text := 'payout_account:' || auth.uid();
  v_secret   uuid;
  v_row      public.supplier_payout_accounts;
  v_key      text;
begin
  if not public.current_role_is('supplier') then raise exception 'Supplier account required' using errcode = '42501'; end if;
  select * into v_existing from public.supplier_payout_accounts where supplier_id = auth.uid() for update;

  if v_num is null and v_existing.supplier_id is null then raise exception 'Account number is required'; end if;
  if v_num is not null and v_num !~ '^[A-Z0-9+]{4,34}$' then raise exception 'Enter a valid account number, IBAN or phone number'; end if;
  if upper(p_country_code) !~ '^[A-Z]{2}$' then raise exception 'Invalid country code'; end if;
  if upper(p_currency) !~ '^[A-Z]{3}$' then raise exception 'Invalid currency'; end if;
  if char_length(trim(coalesce(p_beneficiary_name, ''))) < 2 then raise exception 'Account holder name is required'; end if;
  if jsonb_typeof(coalesce(p_international, '{}'::jsonb)) <> 'object' then raise exception 'Invalid international details'; end if;
  for v_key in select jsonb_object_keys(coalesce(p_international, '{}'::jsonb)) loop
    if v_key not in ('routing_number', 'swift_code', 'beneficiary_address')
       or jsonb_typeof(p_international -> v_key) <> 'string' or char_length(p_international ->> v_key) > 200 then
      raise exception 'Invalid international field %', v_key;
    end if;
  end loop;

  v_secret := v_existing.account_number_secret_id;
  if v_num is not null then
    if v_secret is null then
      select id into v_secret from vault.secrets where name = v_name;   -- orphan from a past row
    end if;
    if v_secret is null then
      v_secret := vault.create_secret(v_num, v_name, 'SokoGlobal supplier payout account number');
    else
      perform vault.update_secret(v_secret, v_num);
    end if;
  end if;

  insert into public.supplier_payout_accounts as a
    (supplier_id, method, country_code, currency, bank_code, bank_name, beneficiary_name, international,
     account_number_secret_id, account_last4, account_fingerprint)
  values (auth.uid(), p_method, upper(p_country_code), upper(p_currency), trim(p_bank_code), nullif(trim(p_bank_name), ''),
          trim(p_beneficiary_name), coalesce(p_international, '{}'::jsonb), v_secret, right(v_num, 4), public.payout_fingerprint(v_num))
  on conflict (supplier_id) do update set
    method = excluded.method, country_code = excluded.country_code, currency = excluded.currency,
    bank_code = excluded.bank_code, bank_name = excluded.bank_name, beneficiary_name = excluded.beneficiary_name,
    international = excluded.international, account_number_secret_id = excluded.account_number_secret_id,
    account_last4 = coalesce(excluded.account_last4, a.account_last4),
    account_fingerprint = coalesce(excluded.account_fingerprint, a.account_fingerprint)
  returning * into v_row;

  return jsonb_build_object('last4', v_row.account_last4, 'verified', v_row.verified, 'currency', v_row.currency);
end $$;

-- Audited plaintext access for compliance staff.
create table if not exists public.sensitive_access_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid not null references public.profiles (id) on delete restrict,
  subject_id uuid not null references public.profiles (id) on delete cascade,
  resource   text not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index if not exists sensitive_access_log_actor_idx   on public.sensitive_access_log (actor_id, created_at desc);
create index if not exists sensitive_access_log_subject_idx on public.sensitive_access_log (subject_id, created_at desc);
alter table public.sensitive_access_log enable row level security;
drop policy if exists "access_log: admin reads" on public.sensitive_access_log;
create policy "access_log: admin reads" on public.sensitive_access_log for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.sensitive_access_log from authenticated, anon;

create or replace function public.admin_reveal_payout_account(p_supplier_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_plain text;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason is required to reveal bank details'; end if;
  select d.decrypted_secret into v_plain
    from public.supplier_payout_accounts a join vault.decrypted_secrets d on d.id = a.account_number_secret_id
   where a.supplier_id = p_supplier_id;
  if v_plain is null then raise exception 'No payout account on file'; end if;
  insert into public.sensitive_access_log (actor_id, subject_id, resource, reason)
  values (auth.uid(), p_supplier_id, 'payout_account_number', left(trim(p_reason), 500));
  return v_plain;
end $$;

-- Same bank account registered by more than one supplier = fraud signal.
create or replace function public.admin_payout_duplicates(p_supplier_ids uuid[])
returns table (supplier_id uuid, duplicate_count integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  return query
    select a.supplier_id,
           (select count(*)::int from public.supplier_payout_accounts b
             where b.account_fingerprint = a.account_fingerprint and b.supplier_id <> a.supplier_id)
      from public.supplier_payout_accounts a
     where a.supplier_id = any (p_supplier_ids);
end $$;

-- =============================================================================
-- B. FX payouts — payout currency may differ from the order currency (USD)
-- =============================================================================
alter table public.payouts
  add column if not exists payout_currency char(3),
  add column if not exists payout_amount   numeric(18, 2) check (payout_amount > 0),
  add column if not exists fx_rate         numeric(24, 10) check (fx_rate > 0),   -- payout units per 1 USD
  add column if not exists fx_source_cents integer check (fx_source_cents > 0),   -- USD the quote debits
  add column if not exists fx_quoted_at    timestamptz;

create or replace function public.supported_payout_currencies()
returns text[] language sql immutable as $$
  select array['USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS', 'ZAR', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF', 'EGP', 'MAD', 'ZMW']
$$;

-- Replaces 003: decrypts the account number from Vault, and supports FX.
create or replace function public.begin_payout(p_order_id uuid, p_fee_bps integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order    public.orders;
  v_supplier uuid;
  v_payout   public.payouts;
  v_acct     public.supplier_payout_accounts;
  v_number   text;
  v_kyc_ok   boolean;
  v_fee      integer;
  v_hold     text;
begin
  if p_fee_bps < 0 or p_fee_bps > 3000 then raise exception 'Fee out of range'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.escrow_status <> 'released' then raise exception 'Order is not released'; end if;
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
    v_fee := floor(v_order.goods_cents::numeric * p_fee_bps / 10000);
    insert into public.payouts (order_id, supplier_id, gross_cents, fee_cents, amount_cents, currency, reference, status, failure_reason)
    values (p_order_id, v_supplier, v_order.goods_cents, v_fee, v_order.goods_cents - v_fee, v_order.currency,
            'payout_' || p_order_id || '-1',
            case when v_hold is null then 'processing' else 'on_hold' end::public.payout_status, v_hold)
    returning * into v_payout;
    if v_hold is not null then
      insert into public.escrow_events (order_id, from_status, to_status, event_type, note)
      values (p_order_id, 'released', 'released', 'payout_on_hold', v_hold);
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

-- Record the FX quote before the transfer is sent. The DB refuses a quote
-- that would debit more USD than the supplier's net payout.
create or replace function public.record_payout_fx(
  p_payout_id uuid, p_currency text, p_amount numeric, p_rate numeric, p_source_cents integer
) returns void language plpgsql security definer set search_path = public as $$
declare v_payout public.payouts;
begin
  select * into v_payout from public.payouts where id = p_payout_id and status = 'processing' for update;
  if not found then raise exception 'Payout is not processing'; end if;
  if p_source_cents is null or p_source_cents <= 0 or p_source_cents > v_payout.amount_cents then
    raise exception 'FX quote (% cents) exceeds net payout (% cents)', p_source_cents, v_payout.amount_cents;
  end if;
  update public.payouts
     set payout_currency = upper(p_currency), payout_amount = p_amount, fx_rate = p_rate,
         fx_source_cents = p_source_cents, fx_quoted_at = now(), updated_at = now()
   where id = p_payout_id;
end $$;

-- Replaces 003: escrow event metadata now carries the payout currency/amount.
create or replace function public.finish_payout(p_payout_id uuid, p_initiated boolean, p_transfer_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_payout public.payouts;
begin
  update public.payouts
     set status = case when p_initiated then 'processing' else 'failed' end::public.payout_status,
         flw_transfer_id = coalesce(p_transfer_id, flw_transfer_id),
         failure_reason = case when p_initiated then null else left(p_error, 1000) end,
         updated_at = now()
   where id = p_payout_id and status = 'processing'
  returning * into v_payout;
  if not found then return; end if;

  insert into public.escrow_events (order_id, from_status, to_status, event_type, provider_ref, note, metadata)
  values (v_payout.order_id, 'released', 'released',
          case when p_initiated then 'payout_initiated' else 'payout_failed' end,
          p_transfer_id,
          case when p_initiated then 'Flutterwave transfer initiated' else left(p_error, 500) end,
          jsonb_strip_nulls(jsonb_build_object(
            'payout_id', v_payout.id, 'reference', v_payout.reference,
            'amount_cents', v_payout.amount_cents, 'currency', v_payout.currency,
            'payout_currency', v_payout.payout_currency, 'payout_amount', v_payout.payout_amount,
            'fx_rate', v_payout.fx_rate)));
end $$;

-- =============================================================================
-- C. Shipment tracking
--    discharge_timestamp = when the consolidated shipment departed the origin
--    hub (freight "discharged" to the carrier); eta_timestamp = arrival.
-- =============================================================================
do $$ begin
  create type public.shipment_status as enum
    ('awaiting_dispatch', 'in_transit', 'arrived', 'customs_cleared', 'out_for_delivery', 'delivered');
exception when duplicate_object then null; end $$;

create or replace function public.is_geo_point(p jsonb)
returns boolean language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when jsonb_typeof(p -> 'lat') <> 'number' or jsonb_typeof(p -> 'lng') <> 'number' then false
    else (p ->> 'lat')::numeric between -90 and 90 and (p ->> 'lng')::numeric between -180 and 180
  end
$$;

create or replace function public.is_geo_path(p jsonb)
returns boolean language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) > 500 then false
    else not exists (select 1 from jsonb_array_elements(p) e where not public.is_geo_point(e))
  end
$$;

alter table public.orders
  add column if not exists discharge_timestamp timestamptz,
  add column if not exists eta_timestamp       timestamptz,
  add column if not exists origin_port_coords  jsonb,
  add column if not exists destination_coords  jsonb,
  add column if not exists route_waypoints     jsonb not null default '[]'::jsonb,
  add column if not exists current_status      public.shipment_status not null default 'awaiting_dispatch',
  add column if not exists origin_label        text check (char_length(origin_label) <= 80),
  add column if not exists destination_label   text check (char_length(destination_label) <= 80),
  add column if not exists tracking_updated_at timestamptz;

do $$ begin
  alter table public.orders add constraint orders_origin_is_point check (origin_port_coords is null or public.is_geo_point(origin_port_coords));
  alter table public.orders add constraint orders_destination_is_point check (destination_coords is null or public.is_geo_point(destination_coords));
  alter table public.orders add constraint orders_waypoints_is_path check (public.is_geo_path(route_waypoints));
  alter table public.orders add constraint orders_eta_after_discharge check (eta_timestamp is null or discharge_timestamp is null or eta_timestamp > discharge_timestamp);
exception when duplicate_object then null; end $$;

create index if not exists orders_in_transit_eta_idx on public.orders (eta_timestamp)
  where current_status in ('in_transit', 'arrived');

-- Ops / logistics-partner write path. Buyers read via the existing orders RLS.
-- Forward-only sync keeps the escrow timeline consistent with the shipment.
-- Core (service_role only — e.g. a logistics-partner webhook). The admin
-- wrapper below adds the role check. NB: inside SECURITY DEFINER, current_user
-- is the owner, so "who called" must be checked via auth.uid(), never current_user.
create or replace function public.set_shipment_tracking(
  p_order_id uuid,
  p_status public.shipment_status,
  p_discharge timestamptz default null,
  p_eta timestamptz default null,
  p_origin jsonb default null,
  p_destination jsonb default null,
  p_waypoints jsonb default null,
  p_origin_label text default null,
  p_destination_label text default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_order  public.orders;
  v_target public.escrow_status;
  v_rank   constant text[] := array['funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification'];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.escrow_status = 'pending_payment' and p_status <> 'awaiting_dispatch' then
    raise exception 'Order is not paid yet — it cannot ship';
  end if;
  if v_order.escrow_status in ('released', 'refunded', 'cancelled') then
    raise exception 'Order is closed (%)', v_order.escrow_status;
  end if;

  update public.orders set
    current_status      = p_status,
    discharge_timestamp = coalesce(p_discharge, discharge_timestamp),
    eta_timestamp       = coalesce(p_eta, eta_timestamp),
    origin_port_coords  = coalesce(p_origin, origin_port_coords),
    destination_coords  = coalesce(p_destination, destination_coords),
    route_waypoints     = coalesce(p_waypoints, route_waypoints),
    origin_label        = coalesce(p_origin_label, origin_label),
    destination_label   = coalesce(p_destination_label, destination_label),
    tracking_updated_at = now()
  where id = p_order_id
  returning * into v_order;

  v_target := case p_status
    when 'in_transit'       then 'in_transit'
    when 'arrived'          then 'in_transit'
    when 'customs_cleared'  then 'customs_cleared'
    when 'out_for_delivery' then 'customs_cleared'
    when 'delivered'        then 'delivered_pending_verification'
  end::public.escrow_status;

  if v_target is not null and v_order.escrow_status::text = any (v_rank)
     and array_position(v_rank, v_target::text) > array_position(v_rank, v_order.escrow_status::text) then
    update public.orders
       set escrow_status = v_target,
           delivered_at = case when v_target = 'delivered_pending_verification' then now() else delivered_at end
     where id = p_order_id
    returning * into v_order;
  end if;
  return v_order;
end $$;

create or replace function public.admin_set_shipment_tracking(
  p_order_id uuid, p_status public.shipment_status,
  p_discharge timestamptz default null, p_eta timestamptz default null,
  p_origin jsonb default null, p_destination jsonb default null, p_waypoints jsonb default null,
  p_origin_label text default null, p_destination_label text default null
) returns public.orders language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  return public.set_shipment_tracking(p_order_id, p_status, p_discharge, p_eta, p_origin, p_destination,
                                      p_waypoints, p_origin_label, p_destination_label);
end $$;

-- =============================================================================
-- D. Ops alerting — items needing a human, de-duplicated per 24h
-- =============================================================================
create table if not exists public.ops_alerts (
  key             text primary key,
  kind            text not null,
  reference       text not null,
  detail          text,
  amount_cents    bigint,
  currency        text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_alerted_at timestamptz,
  resolved_at     timestamptz
);
create index if not exists ops_alerts_open_idx on public.ops_alerts (kind) where resolved_at is null;
alter table public.ops_alerts enable row level security;
drop policy if exists "ops_alerts: admin reads" on public.ops_alerts;
create policy "ops_alerts: admin reads" on public.ops_alerts for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.ops_alerts from authenticated, anon;

-- Refresh the alert set and return items due for (re-)notification.
-- Does NOT mark them sent — call mark_ops_alerts_sent() after Slack accepts.
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
     and e.received_at > now() - interval '7 days';

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

create or replace function public.mark_ops_alerts_sent(p_keys text[])
returns void language sql security definer set search_path = public as $$
  update public.ops_alerts set last_alerted_at = now() where key = any (p_keys);
$$;

-- =============================================================================
-- Grants
-- =============================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'begin_payout(uuid, integer)', 'record_payout_fx(uuid, text, numeric, numeric, integer)',
    'finish_payout(uuid, boolean, text, text)', 'pending_ops_alerts(interval)', 'mark_ops_alerts_sent(text[])',
    'set_shipment_tracking(uuid, public.shipment_status, timestamptz, timestamptz, jsonb, jsonb, jsonb, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'upsert_payout_account(public.payout_method, text, text, text, text, text, text, jsonb)',
    'admin_reveal_payout_account(uuid, text)', 'admin_payout_duplicates(uuid[])',
    'admin_set_shipment_tracking(uuid, public.shipment_status, timestamptz, timestamptz, jsonb, jsonb, jsonb, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
