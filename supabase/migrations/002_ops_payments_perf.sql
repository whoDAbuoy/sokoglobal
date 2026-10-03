-- =============================================================================
-- Migration 002 — performance indexes, RLS tuning, admin ops, Flutterwave escrow
-- Run after schema.sql (SQL editor or `supabase db push`). Safe to re-run the
-- index/alter-policy sections; functions use CREATE OR REPLACE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Foreign-key indexes
--    Every FK column used in RLS sub-queries / joins gets a b-tree index.
--    Already covered by schema.sql (listed for completeness, IF NOT EXISTS):
--      products.supplier_id, orders.buyer_id, orders.product_id,
--      product_media.product_id, escrow_events.order_id,
--      pool_members.pool_id (leading column of the PK).
--    NOTE: on a large live table use CREATE INDEX CONCURRENTLY, one statement
--    per run (it cannot run inside a transaction block).
-- ---------------------------------------------------------------------------
create index if not exists products_supplier_idx      on public.products (supplier_id);
create index if not exists orders_buyer_idx           on public.orders (buyer_id, created_at desc);
create index if not exists orders_product_idx         on public.orders (product_id);
create index if not exists product_media_product_idx  on public.product_media (product_id, sort_order);
create index if not exists escrow_events_order_idx    on public.escrow_events (order_id, created_at);

-- Previously missing:
create index if not exists product_media_supplier_idx on public.product_media (supplier_id);
create index if not exists trend_pools_product_idx    on public.trend_pools (product_id);
create index if not exists pool_members_buyer_idx     on public.pool_members (buyer_id);
create index if not exists orders_pool_idx            on public.orders (pool_id) where pool_id is not null;

-- RLS predicate helpers: "status = 'live'" scans and the admin review queue.
create index if not exists products_status_idx        on public.products (status, created_at desc);
create index if not exists profiles_role_idx          on public.profiles (id, role);

-- ---------------------------------------------------------------------------
-- 2. RLS tuning: wrap auth.uid() in a scalar sub-select so Postgres evaluates
--    it once per statement (initPlan) instead of once per row. This is the
--    single biggest RLS win on Supabase.
-- ---------------------------------------------------------------------------
alter policy "profiles: read own"   on public.profiles using (id = (select auth.uid()));
alter policy "profiles: update own" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy "products: supplier reads own" on public.products using (supplier_id = (select auth.uid()));
alter policy "products: supplier inserts own" on public.products
  with check (supplier_id = (select auth.uid()) and status = 'draft' and (select public.current_role_is('supplier')));
alter policy "products: supplier edits own drafts" on public.products
  using (supplier_id = (select auth.uid()) and status = 'draft')
  with check (supplier_id = (select auth.uid()) and status = 'draft');

alter policy "media: read if product visible" on public.product_media using (
  exists (select 1 from public.products p where p.id = product_id
          and (p.status = 'live' or p.supplier_id = (select auth.uid())))
);
alter policy "media: supplier inserts on own draft" on public.product_media with check (
  supplier_id = (select auth.uid())
  and exists (select 1 from public.products p where p.id = product_id
              and p.supplier_id = (select auth.uid()) and p.status = 'draft')
);
alter policy "media: supplier deletes on own draft" on public.product_media using (
  supplier_id = (select auth.uid())
  and exists (select 1 from public.products p where p.id = product_id and p.status = 'draft')
);

alter policy "pool_members: read own" on public.pool_members using (buyer_id = (select auth.uid()));
alter policy "orders: buyer reads"    on public.orders using (buyer_id = (select auth.uid()));
alter policy "orders: supplier reads" on public.orders using (
  exists (select 1 from public.products p where p.id = product_id and p.supplier_id = (select auth.uid()))
);
alter policy "escrow_events: read with order" on public.escrow_events using (
  exists (select 1 from public.orders o where o.id = order_id
          and (o.buyer_id = (select auth.uid())
               or exists (select 1 from public.products p where p.id = o.product_id and p.supplier_id = (select auth.uid()))))
);

alter policy "storage: suppliers upload to own folder" on storage.objects with check (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.current_role_is('supplier'))
);
alter policy "storage: suppliers delete own files" on storage.objects
  using (bucket_id = 'product-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
alter policy "storage: suppliers list own files" on storage.objects
  using (bucket_id = 'product-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 3. Admin operations: review metadata, read access, approve/reject functions
--    Admins are never self-registered. Promote a staff account with:
--      update public.profiles set role = 'admin' where id = '<auth user uuid>';
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists review_notes text check (char_length(review_notes) <= 2000),
  add column if not exists reviewed_by  uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at  timestamptz;
create index if not exists products_reviewed_by_idx on public.products (reviewed_by) where reviewed_by is not null;

drop policy if exists "products: admin reads all" on public.products;
create policy "products: admin reads all" on public.products for select to authenticated
  using ((select public.current_role_is('admin')));
drop policy if exists "media: admin reads all" on public.product_media;
create policy "media: admin reads all" on public.product_media for select to authenticated
  using ((select public.current_role_is('admin')));
drop policy if exists "profiles: admin reads all" on public.profiles;
create policy "profiles: admin reads all" on public.profiles for select to authenticated
  using ((select public.current_role_is('admin')));

-- Approve: set the platform's freight + customs quote and publish.
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
     or p_freight_cents > 10000000 or p_customs_cents > 10000000 then   -- $100k sanity cap
    raise exception 'Freight and customs must be between $0 and $100,000';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if v_product.status <> 'pending_review' then
    raise exception 'Product is not awaiting review (status: %)', v_product.status;
  end if;
  if v_product.trial_goods_cents + p_freight_cents + p_customs_cents < public.trial_batch_min_cents() then
    raise exception 'Guaranteed Landed Cost must be at least $500 (currently $%)',
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

-- Reject: send back to the supplier as a draft with mandatory feedback.
create or replace function public.admin_reject_product(p_product_id uuid, p_notes text)
returns public.products language plpgsql security definer set search_path = public as $$
declare v_product public.products;
begin
  if not public.current_role_is('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Explain what the supplier needs to fix';
  end if;

  update public.products
     set status = 'draft', review_notes = left(trim(p_notes), 2000),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_product_id and status = 'pending_review'
  returning * into v_product;
  if not found then raise exception 'Product is not awaiting review'; end if;
  return v_product;
end $$;

revoke execute on function public.admin_approve_product(uuid, integer, integer, text) from public, anon;
revoke execute on function public.admin_reject_product(uuid, text)                   from public, anon;
grant  execute on function public.admin_approve_product(uuid, integer, integer, text) to authenticated;
grant  execute on function public.admin_reject_product(uuid, text)                   to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Flutterwave escrow funding
--    tx_ref conventions (built in lib/payments/flutterwave.ts):
--      ord_<order uuid>                    → orders
--      pool_<pool uuid>_<buyer uuid>       → pool_members (Trend Pool pledge)
--    "Pledged" in product language = escrow_status 'pending_payment' in the DB.
-- ---------------------------------------------------------------------------
alter table public.pool_members
  add column if not exists payment_ref text unique,
  add column if not exists paid_at     timestamptz;
alter table public.orders add column if not exists funded_at timestamptz;

-- Idempotency + audit log of every webhook delivery. Service role only.
create table if not exists public.payment_events (
  id           bigint generated always as identity primary key,
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  tx_ref       text,
  payload      jsonb not null,
  outcome      text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);
create index if not exists payment_events_tx_ref_idx on public.payment_events (tx_ref);
alter table public.payment_events enable row level security;  -- no policies: only service_role can touch it
drop policy if exists "payment_events: admin reads" on public.payment_events;
create policy "payment_events: admin reads" on public.payment_events for select to authenticated
  using ((select public.current_role_is('admin')));

-- Atomically move a pledge/order from pending_payment → funded.
-- Returns an outcome code; never raises for business mismatches so the
-- webhook can record them and still return 200 to Flutterwave.
create or replace function public.apply_flutterwave_payment(
  p_tx_ref text, p_provider_ref text, p_amount_cents integer, p_currency text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_uuid  constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_m     text[];
  v_order public.orders;
  v_member public.pool_members;
begin
  -- Order: ord_<uuid>
  v_m := regexp_match(lower(p_tx_ref), '^ord_(' || v_uuid || ')$');
  if v_m is not null then
    select * into v_order from public.orders where id = v_m[1]::uuid for update;
    if not found then return 'unknown_reference'; end if;
    if v_order.escrow_status <> 'pending_payment' then return 'already_processed'; end if;
    if upper(p_currency) <> v_order.currency then return 'currency_mismatch'; end if;
    if p_amount_cents < v_order.total_cents then return 'amount_mismatch'; end if;

    update public.orders
       set escrow_status = 'funded', payment_provider = 'flutterwave',
           payment_ref = p_provider_ref, funded_at = now()
     where id = v_order.id;
    return 'order_funded';
  end if;

  -- Trend Pool pledge: pool_<pool uuid>_<buyer uuid>
  v_m := regexp_match(lower(p_tx_ref), '^pool_(' || v_uuid || ')_(' || v_uuid || ')$');
  if v_m is not null then
    select * into v_member from public.pool_members
     where pool_id = v_m[1]::uuid and buyer_id = v_m[2]::uuid for update;
    if not found then return 'unknown_reference'; end if;
    if v_member.payment_status <> 'pending_payment' then return 'already_processed'; end if;
    if upper(p_currency) <> 'USD' then return 'currency_mismatch'; end if;
    if p_amount_cents < v_member.contribution_cents then return 'amount_mismatch'; end if;

    update public.pool_members
       set payment_status = 'funded', payment_ref = p_provider_ref, paid_at = now()
     where pool_id = v_member.pool_id and buyer_id = v_member.buyer_id;
    return 'pledge_funded';
  end if;

  return 'unknown_reference';
end $$;

revoke execute on function public.apply_flutterwave_payment(text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.apply_flutterwave_payment(text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Health check — should return zero rows (every FK column is indexed).
-- ---------------------------------------------------------------------------
-- select c.conrelid::regclass as table_name, a.attname as fk_column
--   from pg_constraint c
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
--    and not exists (select 1 from pg_index i
--                     where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
