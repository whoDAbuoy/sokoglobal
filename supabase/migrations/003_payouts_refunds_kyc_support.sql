-- =============================================================================
-- Migration 003 — checkout attempts, supplier payouts, pool expiry & refunds,
-- supplier KYC, support tickets. Run after 002. Re-runnable.
--
-- Money-moving functions are granted to service_role ONLY and are designed to
-- be idempotent: every external call (Flutterwave) is preceded by a DB "claim"
-- so a retried request or concurrent cron run can never pay or refund twice.
-- =============================================================================

do $$ begin
  create type public.kyc_status     as enum ('not_started', 'submitted', 'approved', 'rejected');
  create type public.kyc_doc_type   as enum ('tax_certificate', 'business_registration', 'identity');
  create type public.payout_method  as enum ('bank', 'mobile_money');
  create type public.payout_status  as enum ('processing', 'succeeded', 'failed', 'on_hold');
  create type public.ticket_status  as enum ('open', 'awaiting_customer', 'resolved');
  create type public.ticket_category as enum ('order_inquiry', 'dispute', 'payment', 'shipping', 'other');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- A. Checkout attempts — Flutterwave requires a unique tx_ref per transaction.
--    Attempt 1 → ord_<id> / pool_<pool>_<buyer>; retries append "-<n>".
-- =============================================================================
alter table public.orders       add column if not exists payment_attempts integer not null default 0;
alter table public.pool_members add column if not exists payment_attempts integer not null default 0;

create or replace function public.begin_payment_attempt(p_kind text, p_ref_id uuid, p_buyer_id uuid)
returns table (o_tx_ref text, o_amount_cents integer, o_currency text)
language plpgsql security definer set search_path = public as $$
declare v_attempt integer; v_amount integer; v_currency text;
begin
  if p_kind = 'order' then
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

  else
    raise exception 'Unknown payment kind %', p_kind;
  end if;

  if v_attempt > 1 then o_tx_ref := o_tx_ref || '-' || v_attempt; end if;
  o_amount_cents := v_amount;
  o_currency := v_currency;
  return next;
end $$;

-- Pledges are single-shot: a top-up would need a second payment against the
-- same membership, which the amount check below can't reconcile.
create or replace function public.join_trend_pool(p_pool_id uuid, p_amount_cents integer)
returns public.pool_members language plpgsql security definer set search_path = public as $$
declare v_pool public.trend_pools; v_member public.pool_members;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can join Trend Pools' using errcode = '42501';
  end if;
  select * into v_pool from public.trend_pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found' using errcode = 'P0002'; end if;
  if v_pool.status <> 'open' or v_pool.deadline < now() then
    raise exception 'This pool is no longer accepting contributions';
  end if;
  if exists (select 1 from public.pool_members where pool_id = p_pool_id and buyer_id = auth.uid()) then
    raise exception 'You have already pledged to this pool';
  end if;
  if p_amount_cents is null or p_amount_cents < v_pool.min_contribution_cents then
    raise exception 'Minimum contribution is $%', to_char(v_pool.min_contribution_cents / 100.0, 'FM999990.00');
  end if;
  if v_pool.pledged_cents + p_amount_cents > v_pool.target_cents then
    raise exception 'Only $% remaining in this pool', to_char((v_pool.target_cents - v_pool.pledged_cents) / 100.0, 'FM999990.00');
  end if;
  if v_pool.member_count >= v_pool.max_members then raise exception 'This pool is full'; end if;

  insert into public.pool_members (pool_id, buyer_id, contribution_cents, freight_share_cents)
  values (p_pool_id, auth.uid(), p_amount_cents,
          round(v_pool.freight_total_cents::numeric * p_amount_cents / v_pool.target_cents))
  returning * into v_member;

  update public.trend_pools
     set pledged_cents = pledged_cents + p_amount_cents,
         member_count  = member_count + 1,
         status = case when pledged_cents + p_amount_cents >= target_cents then 'funded'::public.pool_status else status end
   where id = p_pool_id;
  return v_member;
end $$;

-- Pool-member refund bookkeeping (used by D and by late payments below).
alter table public.pool_members
  add column if not exists refund_status     text check (refund_status in ('pending', 'processing', 'succeeded', 'failed')),
  add column if not exists refund_ref        text,
  add column if not exists refund_error      text,
  add column if not exists refund_attempts   integer not null default 0,
  add column if not exists refund_claimed_at timestamptz,
  add column if not exists refunded_at       timestamptz;
create index if not exists pool_members_refund_queue_idx on public.pool_members (refund_status, joined_at)
  where refund_status in ('pending', 'processing');

-- Replaces 002's version: accepts the "-<n>" retry suffix, and a payment that
-- lands after its pool expired is accepted *and queued for refund* instead of
-- being left stranded.
create or replace function public.apply_flutterwave_payment(
  p_tx_ref text, p_provider_ref text, p_amount_cents integer, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_uuid   constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_m      text[];
  v_order  public.orders;
  v_member public.pool_members;
  v_pool   public.trend_pools;
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

  return 'unknown_reference';
end $$;

-- =============================================================================
-- B. Escrow events can now carry provider references (payouts, refunds).
-- =============================================================================
alter table public.escrow_events
  add column if not exists event_type   text not null default 'status_change',
  add column if not exists provider_ref text,
  add column if not exists metadata     jsonb;
create index if not exists escrow_events_provider_ref_idx on public.escrow_events (provider_ref) where provider_ref is not null;

-- =============================================================================
-- C. Supplier KYC + payout accounts
-- =============================================================================
create table if not exists public.supplier_kyc (
  supplier_id         uuid primary key references public.profiles (id) on delete cascade,
  legal_name          text check (char_length(legal_name) between 2 and 200),
  tax_id              text check (char_length(tax_id) between 3 and 64),
  registration_number text check (char_length(registration_number) between 3 and 64),
  registered_address  text check (char_length(registered_address) <= 500),
  status              public.kyc_status not null default 'not_started',
  submitted_at        timestamptz,
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  review_notes        text check (char_length(review_notes) <= 2000),
  updated_at          timestamptz not null default now()
);
create index if not exists supplier_kyc_queue_idx on public.supplier_kyc (status, submitted_at);
create index if not exists supplier_kyc_reviewed_by_idx on public.supplier_kyc (reviewed_by) where reviewed_by is not null;

create table if not exists public.kyc_documents (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.profiles (id) on delete cascade,
  doc_type     public.kyc_doc_type not null,
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) <= 255),
  mime_type    text not null,
  bytes        integer not null check (bytes > 0),
  uploaded_at  timestamptz not null default now(),
  -- A row can only point at the uploader's own storage folder.
  constraint kyc_documents_path_owner check (storage_path like supplier_id::text || '/%')
);
create index if not exists kyc_documents_supplier_idx on public.kyc_documents (supplier_id, doc_type);

-- Raw account numbers are stored in Postgres behind RLS. Hardening option:
-- move account_number into Supabase Vault and keep only the last 4 digits here.
create table if not exists public.supplier_payout_accounts (
  supplier_id      uuid primary key references public.profiles (id) on delete cascade,
  method           public.payout_method not null,
  country_code     char(2) not null,
  currency         char(3) not null,
  bank_code        text not null check (char_length(bank_code) between 2 and 20),  -- Flutterwave account_bank (e.g. "044", "MPS")
  bank_name        text check (char_length(bank_name) <= 120),
  account_number   text not null check (account_number ~ '^[A-Za-z0-9+]{4,34}$'),
  beneficiary_name text not null check (char_length(beneficiary_name) between 2 and 120),
  international    jsonb not null default '{}'::jsonb,  -- routing_number, swift_code, beneficiary_address…
  verified         boolean not null default false,
  verified_by      uuid references public.profiles (id) on delete set null,
  verified_at      timestamptz,
  updated_at       timestamptz not null default now()
);
create index if not exists payout_accounts_verified_by_idx on public.supplier_payout_accounts (verified_by) where verified_by is not null;

-- Anti-takeover: any change to where money goes un-verifies the account and
-- puts an approved supplier back in the KYC queue. Payouts hold until re-approved.
create or replace function public.guard_payout_account_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT'
     or (new.method, new.country_code, new.currency, new.bank_code, new.account_number, new.beneficiary_name, new.international)
        is distinct from
        (old.method, old.country_code, old.currency, old.bank_code, old.account_number, old.beneficiary_name, old.international)
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
drop trigger if exists payout_account_guard on public.supplier_payout_accounts;
create trigger payout_account_guard before insert or update on public.supplier_payout_accounts
  for each row execute function public.guard_payout_account_change();

alter table public.supplier_kyc             enable row level security;
alter table public.kyc_documents            enable row level security;
alter table public.supplier_payout_accounts enable row level security;

drop policy if exists "kyc: supplier reads own"   on public.supplier_kyc;
drop policy if exists "kyc: supplier creates own" on public.supplier_kyc;
drop policy if exists "kyc: supplier edits own"   on public.supplier_kyc;
drop policy if exists "kyc: admin reads"          on public.supplier_kyc;
create policy "kyc: supplier reads own" on public.supplier_kyc for select using (supplier_id = (select auth.uid()));
create policy "kyc: supplier creates own" on public.supplier_kyc for insert
  with check (supplier_id = (select auth.uid()) and (select public.current_role_is('supplier')));
create policy "kyc: supplier edits own" on public.supplier_kyc for update
  using (supplier_id = (select auth.uid()) and status in ('not_started', 'rejected'))
  with check (supplier_id = (select auth.uid()));
create policy "kyc: admin reads" on public.supplier_kyc for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update on public.supplier_kyc from authenticated, anon;
grant insert (supplier_id, legal_name, tax_id, registration_number, registered_address) on public.supplier_kyc to authenticated;
grant update (legal_name, tax_id, registration_number, registered_address) on public.supplier_kyc to authenticated;

drop policy if exists "kyc_docs: supplier reads own"     on public.kyc_documents;
drop policy if exists "kyc_docs: supplier adds own"      on public.kyc_documents;
drop policy if exists "kyc_docs: supplier removes own"   on public.kyc_documents;
drop policy if exists "kyc_docs: admin reads"            on public.kyc_documents;
create policy "kyc_docs: supplier reads own" on public.kyc_documents for select using (supplier_id = (select auth.uid()));
create policy "kyc_docs: supplier adds own" on public.kyc_documents for insert with check (
  supplier_id = (select auth.uid()) and (select public.current_role_is('supplier'))
  and not exists (select 1 from public.supplier_kyc k where k.supplier_id = (select auth.uid()) and k.status in ('submitted', 'approved'))
);
create policy "kyc_docs: supplier removes own" on public.kyc_documents for delete using (
  supplier_id = (select auth.uid())
  and not exists (select 1 from public.supplier_kyc k where k.supplier_id = (select auth.uid()) and k.status in ('submitted', 'approved'))
);
create policy "kyc_docs: admin reads" on public.kyc_documents for select to authenticated using ((select public.current_role_is('admin')));

drop policy if exists "payout_acct: supplier reads own"  on public.supplier_payout_accounts;
drop policy if exists "payout_acct: supplier writes own" on public.supplier_payout_accounts;
drop policy if exists "payout_acct: supplier edits own"  on public.supplier_payout_accounts;
drop policy if exists "payout_acct: admin reads"         on public.supplier_payout_accounts;
create policy "payout_acct: supplier reads own" on public.supplier_payout_accounts for select using (supplier_id = (select auth.uid()));
create policy "payout_acct: supplier writes own" on public.supplier_payout_accounts for insert
  with check (supplier_id = (select auth.uid()) and (select public.current_role_is('supplier')));
create policy "payout_acct: supplier edits own" on public.supplier_payout_accounts for update
  using (supplier_id = (select auth.uid())) with check (supplier_id = (select auth.uid()));
create policy "payout_acct: admin reads" on public.supplier_payout_accounts for select to authenticated using ((select public.current_role_is('admin')));
revoke insert, update on public.supplier_payout_accounts from authenticated, anon;
grant insert (supplier_id, method, country_code, currency, bank_code, bank_name, account_number, beneficiary_name, international)
  on public.supplier_payout_accounts to authenticated;
grant update (method, country_code, currency, bank_code, bank_name, account_number, beneficiary_name, international)
  on public.supplier_payout_accounts to authenticated;

-- Private bucket for KYC documents (served to admins via short-lived signed URLs only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "kyc storage: supplier uploads own" on storage.objects;
drop policy if exists "kyc storage: supplier reads own"   on storage.objects;
drop policy if exists "kyc storage: supplier deletes own" on storage.objects;
drop policy if exists "kyc storage: admin reads"          on storage.objects;
create policy "kyc storage: supplier uploads own" on storage.objects for insert to authenticated with check (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_role_is('supplier')));
create policy "kyc storage: supplier reads own" on storage.objects for select to authenticated using (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kyc storage: supplier deletes own" on storage.objects for delete to authenticated using (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "kyc storage: admin reads" on storage.objects for select to authenticated using (
  bucket_id = 'kyc-documents' and (select public.current_role_is('admin')));

create or replace function public.submit_kyc()
returns public.supplier_kyc language plpgsql security definer set search_path = public as $$
declare v_kyc public.supplier_kyc; v_missing text[];
begin
  if not public.current_role_is('supplier') then raise exception 'Supplier account required' using errcode = '42501'; end if;
  select * into v_kyc from public.supplier_kyc where supplier_id = auth.uid() for update;
  if not found or v_kyc.legal_name is null or v_kyc.tax_id is null or v_kyc.registration_number is null then
    raise exception 'Complete your legal name, Tax ID and registration number first';
  end if;
  if v_kyc.status not in ('not_started', 'rejected') then raise exception 'Verification already submitted'; end if;

  select array_agg(t::text) into v_missing
    from unnest(enum_range(null::public.kyc_doc_type)) t
   where not exists (select 1 from public.kyc_documents d where d.supplier_id = auth.uid() and d.doc_type = t);
  if v_missing is not null then raise exception 'Missing documents: %', array_to_string(v_missing, ', '); end if;
  if not exists (select 1 from public.supplier_payout_accounts where supplier_id = auth.uid()) then
    raise exception 'Add your payout account before submitting';
  end if;

  update public.supplier_kyc set status = 'submitted', submitted_at = now(), updated_at = now()
   where supplier_id = auth.uid() returning * into v_kyc;
  return v_kyc;
end $$;

-- Approve = the only path that sets profiles.kyc_verified and verifies the payout account.
create or replace function public.admin_approve_kyc(p_supplier_id uuid, p_notes text default null)
returns public.supplier_kyc language plpgsql security definer set search_path = public as $$
declare v_kyc public.supplier_kyc;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into v_kyc from public.supplier_kyc where supplier_id = p_supplier_id for update;
  if not found or v_kyc.status <> 'submitted' then raise exception 'Supplier is not awaiting KYC review'; end if;
  if not exists (select 1 from public.supplier_payout_accounts where supplier_id = p_supplier_id) then
    raise exception 'Supplier has no payout account on file';
  end if;

  update public.supplier_kyc
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = nullif(trim(p_notes), ''), updated_at = now()
   where supplier_id = p_supplier_id returning * into v_kyc;
  update public.profiles set kyc_verified = true where id = p_supplier_id;
  update public.supplier_payout_accounts
     set verified = true, verified_by = auth.uid(), verified_at = now()
   where supplier_id = p_supplier_id;
  return v_kyc;
end $$;

create or replace function public.admin_reject_kyc(p_supplier_id uuid, p_notes text)
returns public.supplier_kyc language plpgsql security definer set search_path = public as $$
declare v_kyc public.supplier_kyc;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_notes), '')) < 10 then raise exception 'Explain what the supplier needs to fix (10+ characters)'; end if;
  update public.supplier_kyc
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = left(trim(p_notes), 2000), updated_at = now()
   where supplier_id = p_supplier_id and status = 'submitted'
  returning * into v_kyc;
  if not found then raise exception 'Supplier is not awaiting KYC review'; end if;
  update public.profiles set kyc_verified = false where id = p_supplier_id;
  update public.supplier_payout_accounts set verified = false, verified_by = null, verified_at = null
   where supplier_id = p_supplier_id;
  return v_kyc;
end $$;

-- =============================================================================
-- D. Supplier payouts
-- =============================================================================
create table if not exists public.payouts (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references public.orders (id) on delete restrict,
  supplier_id     uuid not null references public.profiles (id) on delete restrict,
  gross_cents     integer not null check (gross_cents > 0),
  fee_cents       integer not null default 0 check (fee_cents >= 0),
  amount_cents    integer not null check (amount_cents > 0),
  currency        char(3) not null default 'USD',
  reference       text not null unique,
  status          public.payout_status not null,
  flw_transfer_id text unique,
  failure_reason  text,
  attempts        integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists payouts_supplier_idx on public.payouts (supplier_id, created_at desc);
create index if not exists payouts_status_idx on public.payouts (status, updated_at) where status in ('failed', 'on_hold', 'processing');
alter table public.payouts enable row level security;
drop policy if exists "payouts: supplier reads own" on public.payouts;
drop policy if exists "payouts: admin reads" on public.payouts;
create policy "payouts: supplier reads own" on public.payouts for select using (supplier_id = (select auth.uid()));
create policy "payouts: admin reads" on public.payouts for select to authenticated using ((select public.current_role_is('admin')));

-- Claim a payout for a released order. Returns jsonb:
--   { action: 'transfer', payout_id, reference, amount_cents, currency, account{...} }
--   { action: 'hold', reason }   — KYC/account not ready or non-USD (needs FX by ops)
--   { action: 'skip', status }   — already processing/succeeded (idempotent)
create or replace function public.begin_payout(p_order_id uuid, p_fee_bps integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order   public.orders;
  v_supplier uuid;
  v_payout  public.payouts;
  v_acct    public.supplier_payout_accounts;
  v_kyc_ok  boolean;
  v_fee     integer;
  v_hold    text;
begin
  if p_fee_bps < 0 or p_fee_bps > 3000 then raise exception 'Fee out of range'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.escrow_status <> 'released' then raise exception 'Order is not released'; end if;
  select supplier_id into v_supplier from public.products where id = v_order.product_id;

  select kyc_verified into v_kyc_ok from public.profiles where id = v_supplier;
  select * into v_acct from public.supplier_payout_accounts where supplier_id = v_supplier;
  v_hold := case
    when not coalesce(v_kyc_ok, false) then 'Supplier KYC not approved'
    when v_acct.supplier_id is null     then 'No payout account on file'
    when not v_acct.verified            then 'Payout account not verified'
    when v_acct.currency <> v_order.currency then 'Payout account currency ' || v_acct.currency || ' requires an FX quote'
  end;

  select * into v_payout from public.payouts where order_id = p_order_id for update;
  if found then
    if v_payout.status in ('processing', 'succeeded') then
      return jsonb_build_object('action', 'skip', 'status', v_payout.status, 'payout_id', v_payout.id);
    end if;
    if v_payout.status = 'failed' and v_payout.attempts >= 5 then
      return jsonb_build_object('action', 'hold', 'reason', 'Max payout attempts reached — manual review', 'payout_id', v_payout.id);
    end if;
    -- failed (retryable) or on_hold → re-evaluate
    if v_hold is not null then
      update public.payouts set status = 'on_hold', failure_reason = v_hold, updated_at = now() where id = v_payout.id;
      return jsonb_build_object('action', 'hold', 'reason', v_hold, 'payout_id', v_payout.id);
    end if;
    update public.payouts
       set status = 'processing', attempts = attempts + 1, failure_reason = null, updated_at = now(),
           reference = 'payout_' || p_order_id || '-' || (attempts + 1)
     where id = v_payout.id returning * into v_payout;
  else
    -- Supplier receives the goods value; freight & customs fund the platform's logistics.
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
      'account_number', v_acct.account_number, 'beneficiary_name', v_acct.beneficiary_name,
      'country_code', v_acct.country_code, 'currency', v_acct.currency, 'international', v_acct.international));
end $$;

-- Record the result of the transfer API call (initiated or failed to initiate).
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
          jsonb_build_object('payout_id', v_payout.id, 'reference', v_payout.reference,
                             'amount_cents', v_payout.amount_cents, 'currency', v_payout.currency));
end $$;

-- Final status from the transfer.completed webhook.
create or replace function public.complete_payout(p_reference text, p_transfer_id text, p_success boolean, p_message text)
returns text language plpgsql security definer set search_path = public as $$
declare v_payout public.payouts;
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
  insert into public.escrow_events (order_id, from_status, to_status, event_type, provider_ref, note)
  values (v_payout.order_id, 'released', 'released',
          case when p_success then 'payout_succeeded' else 'payout_failed' end, p_transfer_id, left(p_message, 500));
  return case when p_success then 'payout_succeeded' else 'payout_failed' end;
end $$;

-- =============================================================================
-- E. Trend Pool expiry & refunds
-- =============================================================================
-- Expire pools past their deadline whose *paid* (escrow-funded) total is below
-- target — pledges alone don't ship a container.
create or replace function public.expire_due_pools()
returns table (pool_id uuid, title text, paid_cents bigint, target_cents integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_ids uuid[];
begin
  select array_agg(p.id) into v_ids from (
    select tp.id from public.trend_pools tp
     where tp.status in ('open', 'funded') and tp.deadline < now()
       and coalesce((select sum(m.contribution_cents) from public.pool_members m
                      where m.pool_id = tp.id and m.payment_status = 'funded'), 0) < tp.target_cents
     for update skip locked
  ) p;
  if v_ids is null then return; end if;

  update public.trend_pools set status = 'expired' where id = any (v_ids);
  update public.pool_members set payment_status = 'cancelled'
   where pool_members.pool_id = any (v_ids) and payment_status = 'pending_payment';
  update public.pool_members set refund_status = 'pending'
   where pool_members.pool_id = any (v_ids) and payment_status = 'funded' and refund_status is null;

  return query
    select tp.id, tp.title,
           coalesce((select sum(m.contribution_cents) from public.pool_members m where m.pool_id = tp.id and m.payment_status = 'funded'), 0),
           tp.target_cents
      from public.trend_pools tp where tp.id = any (v_ids);
end $$;

-- Claim a batch of refunds. SKIP LOCKED + 'processing' state = no double refunds
-- even with overlapping cron runs.
create or replace function public.claim_pool_refunds(p_limit integer default 25)
returns table (pool_id uuid, buyer_id uuid, transaction_id text, amount_cents integer, attempt integer)
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
  returning m.pool_id, m.buyer_id, m.payment_ref, m.contribution_cents, m.refund_attempts;
end $$;

create or replace function public.finish_pool_refund(
  p_pool_id uuid, p_buyer_id uuid, p_success boolean, p_refund_ref text, p_error text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pool_members
     set payment_status = case when p_success then 'refunded'::public.escrow_status else payment_status end,
         refund_status  = case when p_success then 'succeeded'
                               when refund_attempts >= 5 then 'failed'   -- needs manual action
                               else 'pending' end,                        -- retried next run
         refund_ref     = coalesce(p_refund_ref, refund_ref),
         refund_error   = case when p_success then null else left(p_error, 1000) end,
         refunded_at    = case when p_success then now() else refunded_at end
   where pool_id = p_pool_id and buyer_id = p_buyer_id and refund_status = 'processing';
end $$;

-- =============================================================================
-- F. Support tickets & messages (Realtime-enabled)
-- =============================================================================
create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  order_id        uuid references public.orders (id) on delete set null,
  category        public.ticket_category not null default 'order_inquiry',
  subject         text not null check (char_length(subject) between 3 and 140),
  status          public.ticket_status not null default 'open',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx  on public.support_tickets (user_id, last_message_at desc);
create index if not exists support_tickets_order_idx on public.support_tickets (order_id) where order_id is not null;
create index if not exists support_tickets_queue_idx on public.support_tickets (status, last_message_at desc);

create table if not exists public.support_messages (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'agent')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, id);
create index if not exists support_messages_sender_idx on public.support_messages (sender_id);

-- Server decides who the sender is — clients can't impersonate an agent.
create or replace function public.stamp_support_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  new.sender_role := case when public.current_role_is('admin') then 'agent' else 'customer' end;
  return new;
end $$;
drop trigger if exists support_message_stamp on public.support_messages;
create trigger support_message_stamp before insert on public.support_messages
  for each row execute function public.stamp_support_message();

create or replace function public.bump_support_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets
     set last_message_at = new.created_at, updated_at = now(),
         status = case when new.sender_role = 'agent' then 'awaiting_customer' else 'open' end::public.ticket_status
   where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists support_message_bump on public.support_messages;
create trigger support_message_bump after insert on public.support_messages
  for each row execute function public.bump_support_ticket();

alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "tickets: owner reads"   on public.support_tickets;
drop policy if exists "tickets: owner creates" on public.support_tickets;
drop policy if exists "tickets: admin reads"   on public.support_tickets;
drop policy if exists "tickets: admin updates" on public.support_tickets;
create policy "tickets: owner reads" on public.support_tickets for select using (user_id = (select auth.uid()));
create policy "tickets: owner creates" on public.support_tickets for insert with check (
  user_id = (select auth.uid())
  and (order_id is null or exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())))
);
create policy "tickets: admin reads" on public.support_tickets for select to authenticated using ((select public.current_role_is('admin')));
create policy "tickets: admin updates" on public.support_tickets for update to authenticated
  using ((select public.current_role_is('admin'))) with check ((select public.current_role_is('admin')));
revoke insert, update on public.support_tickets from authenticated, anon;
grant insert (user_id, order_id, category, subject) on public.support_tickets to authenticated;
grant update (status) on public.support_tickets to authenticated;

drop policy if exists "messages: participants read"  on public.support_messages;
drop policy if exists "messages: participants write" on public.support_messages;
create policy "messages: participants read" on public.support_messages for select using (
  exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid()))
  or (select public.current_role_is('admin'))
);
create policy "messages: participants write" on public.support_messages for insert with check (
  sender_id = (select auth.uid())
  and ((sender_role = 'customer' and exists (select 1 from public.support_tickets t
                                             where t.id = ticket_id and t.user_id = (select auth.uid()) and t.status <> 'resolved'))
       or (sender_role = 'agent' and (select public.current_role_is('admin'))))
);
revoke insert, update, delete on public.support_messages from authenticated, anon;
grant insert (ticket_id, body) on public.support_messages to authenticated;

-- Realtime: Supabase streams inserts to subscribers, filtered by the RLS above.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.support_messages;
  end if;
exception when duplicate_object then null; end $$;

-- =============================================================================
-- Grants
-- =============================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'begin_payment_attempt(text, uuid, uuid)', 'apply_flutterwave_payment(text, text, integer, text)',
    'begin_payout(uuid, integer)', 'finish_payout(uuid, boolean, text, text)',
    'complete_payout(text, text, boolean, text)', 'expire_due_pools()',
    'claim_pool_refunds(integer)', 'finish_pool_refund(uuid, uuid, boolean, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'join_trend_pool(uuid, integer)', 'submit_kyc()', 'admin_approve_kyc(uuid, text)', 'admin_reject_kyc(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
