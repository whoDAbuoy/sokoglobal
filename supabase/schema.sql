-- =============================================================================
-- SokoGlobal — B2B cross-border marketplace (West → Africa)
-- Supabase / PostgreSQL schema
--
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotency is not
-- attempted: run once on a fresh project.
--
-- Security model
--   * Every table has RLS enabled.
--   * Money is stored as integer cents (USD) — never floats.
--   * Anything that moves money or escrow state goes through SECURITY DEFINER
--     functions that compute prices server-side. Clients can never write
--     prices, escrow status or verification flags directly.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role        as enum ('supplier', 'importer', 'admin');
create type public.product_category as enum ('beauty', 'clothing');
create type public.product_status   as enum ('draft', 'pending_review', 'live', 'archived');
create type public.media_type       as enum ('image', 'swatch_video');
create type public.order_type       as enum ('trial', 'pool', 'standard');
create type public.pool_status      as enum ('open', 'funded', 'ordered', 'shipped', 'completed', 'expired', 'cancelled');

-- Escrow lifecycle. Funds are only released to the supplier after the buyer
-- (or a platform inspector) verifies the goods at the local doorstep.
create type public.escrow_status as enum (
  'pending_payment',                -- order created, buyer has not paid
  'funded',                         -- buyer paid; money held in escrow
  'in_transit',                     -- consolidated air freight departed
  'customs_cleared',                -- cleared at destination port
  'delivered_pending_verification', -- at buyer's door, awaiting inspection
  'released',                       -- buyer verified → supplier paid out
  'disputed',                       -- buyer raised an issue, funds frozen
  'refunded',                       -- dispute resolved in buyer's favour
  'cancelled'
);

-- Platform rule: the Trial Batch minimum (Guaranteed Landed Cost), in cents.
create or replace function public.trial_batch_min_cents()
returns integer language sql immutable as $$ select 50000 $$;  -- $500.00

-- ---------------------------------------------------------------------------
-- Users → profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  role           public.user_role not null,
  full_name      text not null check (char_length(full_name) between 2 and 120),
  company_name   text not null check (char_length(company_name) between 2 and 160),
  country_code   char(2) not null,
  kyc_verified   boolean not null default false,   -- set by platform compliance only
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Auto-create a profile from sign-up metadata (see components/Auth.tsx).
-- Self-registration as 'admin' is impossible.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := new.raw_user_meta_data ->> 'role';
begin
  if v_role not in ('supplier', 'importer') then
    raise exception 'Invalid role "%" at sign-up', v_role;
  end if;

  insert into public.profiles (id, role, full_name, company_name, country_code)
  values (
    new.id,
    v_role::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company_name', ''),
    upper(coalesce(new.raw_user_meta_data ->> 'country_code', 'XX'))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_role_is(r public.user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = r)
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Products (Beauty & Clothing)
-- ---------------------------------------------------------------------------
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  supplier_id          uuid not null references public.profiles (id) on delete cascade,
  category             public.product_category not null,
  title                text not null check (char_length(title) between 3 and 140),
  brand                text,
  description          text check (char_length(description) <= 5000),
  origin_country       char(2) not null,
  -- Category-specific attributes, validated in the app layer:
  --   beauty:   { shade_range, skin_types[], inci_ingredients, shelf_life_months, certifications[] }
  --   clothing: { sizes[], materials, fit, size_chart_url }
  attributes           jsonb not null default '{}'::jsonb,
  unit_price_cents     integer not null check (unit_price_cents > 0),
  lead_time_days       integer check (lead_time_days between 1 and 120),

  -- Trial Batch: Guaranteed Landed Cost = goods + consolidated freight + customs.
  -- Supplier sets goods; freight & customs are quoted by the platform's
  -- logistics team during review (suppliers have no write grant on them).
  trial_units          integer not null check (trial_units > 0),
  trial_goods_cents    integer not null check (trial_goods_cents > 0),
  trial_freight_cents  integer not null default 0 check (trial_freight_cents >= 0),
  trial_customs_cents  integer not null default 0 check (trial_customs_cents >= 0),
  trial_landed_cost_cents integer generated always as
    (trial_goods_cents + trial_freight_cents + trial_customs_cents) stored,

  status               public.product_status not null default 'draft',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- A product cannot go live unless its trial batch meets the $500 minimum.
  constraint live_requires_trial_min check (
    status <> 'live'
    or (trial_goods_cents + trial_freight_cents + trial_customs_cents) >= 50000
  )
);
create index products_live_idx on public.products (category, created_at desc) where status = 'live';
create index products_supplier_idx on public.products (supplier_id);
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Product media (real-time photos & standardized swatch videos)
-- ---------------------------------------------------------------------------
create table public.product_media (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  supplier_id   uuid not null references public.profiles (id) on delete cascade,
  media_type    public.media_type not null,
  storage_path  text not null unique,
  public_url    text not null,
  mime_type     text not null,
  bytes         integer not null check (bytes > 0),
  width         integer,
  height        integer,
  captured_at   timestamptz,   -- from the device file; proves photo freshness
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index product_media_product_idx on public.product_media (product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Trend Pools (group buys) — boutiques pool money and split volumetric freight
-- ---------------------------------------------------------------------------
create table public.trend_pools (
  id                      uuid primary key default gen_random_uuid(),
  product_id              uuid not null references public.products (id) on delete restrict,
  title                   text not null,
  description             text,
  destination_country     char(2) not null,
  target_cents            integer not null check (target_cents >= 50000),
  pledged_cents           integer not null default 0 check (pledged_cents >= 0),
  min_contribution_cents  integer not null default 10000 check (min_contribution_cents > 0),
  freight_total_cents     integer not null default 0,   -- full consolidated shipment freight
  volume_cbm              numeric(8, 2),                -- volumetric size of the shipment
  member_count            integer not null default 0,
  max_members             integer not null default 25,
  deadline                timestamptz not null,
  status                  public.pool_status not null default 'open',
  created_at              timestamptz not null default now(),
  constraint pledged_le_target check (pledged_cents <= target_cents)
);
create index trend_pools_open_idx on public.trend_pools (deadline) where status = 'open';

create table public.pool_members (
  pool_id             uuid not null references public.trend_pools (id) on delete cascade,
  buyer_id            uuid not null references public.profiles (id) on delete cascade,
  contribution_cents  integer not null check (contribution_cents > 0),
  -- Each member's share of volumetric freight = contribution / target.
  freight_share_cents integer not null default 0,
  payment_status      public.escrow_status not null default 'pending_payment',
  joined_at           timestamptz not null default now(),
  primary key (pool_id, buyer_id)
);

-- ---------------------------------------------------------------------------
-- Orders + escrow
-- ---------------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references public.profiles (id) on delete restrict,
  product_id      uuid not null references public.products (id) on delete restrict,
  pool_id         uuid references public.trend_pools (id) on delete set null,
  order_type      public.order_type not null,
  quantity        integer not null check (quantity > 0),
  goods_cents     integer not null check (goods_cents >= 0),
  freight_cents   integer not null check (freight_cents >= 0),
  customs_cents   integer not null check (customs_cents >= 0),
  total_cents     integer generated always as (goods_cents + freight_cents + customs_cents) stored,
  currency        char(3) not null default 'USD',
  escrow_status   public.escrow_status not null default 'pending_payment',
  payment_provider text,          -- e.g. 'stripe', 'flutterwave', 'paystack'
  payment_ref      text unique,   -- provider PaymentIntent / transaction id
  delivered_at     timestamptz,
  verified_at      timestamptz,
  released_at      timestamptz,
  dispute_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trial_min_landed_cost check (
    order_type <> 'trial' or (goods_cents + freight_cents + customs_cents) >= 50000
  )
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_product_idx on public.orders (product_id);
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- Immutable audit log of every escrow transition.
create table public.escrow_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status public.escrow_status,
  to_status   public.escrow_status not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index escrow_events_order_idx on public.escrow_events (order_id, created_at);

create or replace function public.log_escrow_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.escrow_status is distinct from old.escrow_status then
    insert into public.escrow_events (order_id, from_status, to_status, actor_id)
    values (new.id, case when tg_op = 'UPDATE' then old.escrow_status end, new.escrow_status, auth.uid());
  end if;
  return new;
end $$;

create trigger orders_escrow_audit after insert or update of escrow_status on public.orders
  for each row execute function public.log_escrow_transition();

-- =============================================================================
-- Business-logic functions (the only write path for money/escrow)
-- =============================================================================

-- Start a $500 Trial Batch. Price is copied from the product server-side.
create or replace function public.create_trial_order(p_product_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_product public.products;
  v_order   public.orders;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can place orders' using errcode = '42501';
  end if;

  select * into v_product from public.products where id = p_product_id and status = 'live';
  if not found then
    raise exception 'Product is not available' using errcode = 'P0002';
  end if;
  if v_product.trial_landed_cost_cents < public.trial_batch_min_cents() then
    raise exception 'Trial batch below platform minimum';
  end if;

  insert into public.orders (buyer_id, product_id, order_type, quantity,
                             goods_cents, freight_cents, customs_cents)
  values (auth.uid(), v_product.id, 'trial', v_product.trial_units,
          v_product.trial_goods_cents, v_product.trial_freight_cents, v_product.trial_customs_cents)
  returning * into v_order;

  return v_order;
end $$;

-- Join (or top up) a Trend Pool atomically. Row lock prevents over-funding.
create or replace function public.join_trend_pool(p_pool_id uuid, p_amount_cents integer)
returns public.pool_members language plpgsql security definer set search_path = public as $$
declare
  v_pool     public.trend_pools;
  v_existing public.pool_members;
  v_member   public.pool_members;
  v_new_total integer;
begin
  if not public.current_role_is('importer') then
    raise exception 'Only African Importer accounts can join Trend Pools' using errcode = '42501';
  end if;

  select * into v_pool from public.trend_pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found' using errcode = 'P0002'; end if;
  if v_pool.status <> 'open' or v_pool.deadline < now() then
    raise exception 'This pool is no longer accepting contributions';
  end if;

  select * into v_existing from public.pool_members where pool_id = p_pool_id and buyer_id = auth.uid();
  v_new_total := coalesce(v_existing.contribution_cents, 0) + p_amount_cents;

  if p_amount_cents <= 0 or v_new_total < v_pool.min_contribution_cents then
    raise exception 'Minimum contribution is % cents', v_pool.min_contribution_cents;
  end if;
  if v_pool.pledged_cents + p_amount_cents > v_pool.target_cents then
    raise exception 'Only % cents remaining in this pool', v_pool.target_cents - v_pool.pledged_cents;
  end if;
  if v_existing.pool_id is null and v_pool.member_count >= v_pool.max_members then
    raise exception 'This pool is full';
  end if;

  insert into public.pool_members (pool_id, buyer_id, contribution_cents, freight_share_cents)
  values (p_pool_id, auth.uid(), v_new_total,
          round(v_pool.freight_total_cents::numeric * v_new_total / v_pool.target_cents))
  on conflict (pool_id, buyer_id) do update
    set contribution_cents  = excluded.contribution_cents,
        freight_share_cents = excluded.freight_share_cents
  returning * into v_member;

  update public.trend_pools
     set pledged_cents = pledged_cents + p_amount_cents,
         member_count  = member_count + case when v_existing.pool_id is null then 1 else 0 end,
         status        = case when pledged_cents + p_amount_cents >= target_cents
                              then 'funded'::public.pool_status else status end
   where id = p_pool_id;

  return v_member;
end $$;

-- Buyer confirms goods were received and inspected → release escrow.
-- The actual payout (Stripe Connect transfer, etc.) is triggered by the API
-- route after this returns (see app/api/orders/[id]/confirm/route.ts).
create or replace function public.confirm_delivery(p_order_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  update public.orders
     set escrow_status = 'released', verified_at = now(), released_at = now()
   where id = p_order_id
     and buyer_id = auth.uid()
     and escrow_status = 'delivered_pending_verification'
  returning * into v_order;

  if not found then
    raise exception 'Order is not awaiting your verification';
  end if;
  return v_order;
end $$;

-- Buyer freezes funds by opening a dispute (any time after payment, before release).
create or replace function public.open_dispute(p_order_id uuid, p_reason text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  update public.orders
     set escrow_status = 'disputed', dispute_reason = left(p_reason, 2000)
   where id = p_order_id
     and buyer_id = auth.uid()
     and escrow_status in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification')
  returning * into v_order;
  if not found then raise exception 'Order cannot be disputed in its current state'; end if;
  return v_order;
end $$;

-- Supplier submits a draft for review. Enforces the Visual Proof rule:
-- ≥ 3 real photos, and beauty products need ≥ 1 standardized swatch video.
create or replace function public.submit_product_for_review(p_product_id uuid)
returns public.products language plpgsql security definer set search_path = public as $$
declare
  v_product public.products;
  v_images  integer;
  v_videos  integer;
begin
  select * into v_product from public.products
   where id = p_product_id and supplier_id = auth.uid() and status = 'draft'
   for update;
  if not found then raise exception 'Draft product not found'; end if;

  select count(*) filter (where media_type = 'image'),
         count(*) filter (where media_type = 'swatch_video')
    into v_images, v_videos
    from public.product_media where product_id = p_product_id;

  if v_images < 3 then
    raise exception 'Upload at least 3 real product photos (currently %)', v_images;
  end if;
  if v_product.category = 'beauty' and v_videos < 1 then
    raise exception 'Beauty products require at least one swatch video';
  end if;

  update public.products set status = 'pending_review' where id = p_product_id
  returning * into v_product;
  return v_product;
end $$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles      enable row level security;
alter table public.products      enable row level security;
alter table public.product_media enable row level security;
alter table public.trend_pools   enable row level security;
alter table public.pool_members  enable row level security;
alter table public.orders        enable row level security;
alter table public.escrow_events enable row level security;

-- profiles: you see yourself; everyone signed in can see supplier storefront info.
create policy "profiles: read own"       on public.profiles for select using (id = auth.uid());
create policy "profiles: read suppliers" on public.profiles for select to authenticated using (role = 'supplier');
create policy "profiles: update own"     on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Column-level: users can never change role / kyc_verified / country themselves.
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, company_name) on public.profiles to authenticated;

-- products
create policy "products: read live" on public.products for select to authenticated using (status = 'live');
create policy "products: supplier reads own" on public.products for select using (supplier_id = auth.uid());
create policy "products: supplier inserts own" on public.products for insert
  with check (supplier_id = auth.uid() and status = 'draft' and public.current_role_is('supplier'));
create policy "products: supplier edits own drafts" on public.products for update
  using (supplier_id = auth.uid() and status = 'draft') with check (supplier_id = auth.uid() and status = 'draft');
revoke insert, update on public.products from authenticated, anon;
grant insert (supplier_id, category, title, brand, description, origin_country, attributes,
              unit_price_cents, lead_time_days, trial_units, trial_goods_cents)
  on public.products to authenticated;
grant update (title, brand, description, attributes, unit_price_cents, lead_time_days,
              trial_units, trial_goods_cents)
  on public.products to authenticated;

-- product_media
create policy "media: read if product visible" on public.product_media for select using (
  exists (select 1 from public.products p where p.id = product_id
          and (p.status = 'live' or p.supplier_id = auth.uid()))
);
create policy "media: supplier inserts on own draft" on public.product_media for insert with check (
  supplier_id = auth.uid()
  and exists (select 1 from public.products p where p.id = product_id
              and p.supplier_id = auth.uid() and p.status = 'draft')
);
create policy "media: supplier deletes on own draft" on public.product_media for delete using (
  supplier_id = auth.uid()
  and exists (select 1 from public.products p where p.id = product_id and p.status = 'draft')
);

-- trend pools: readable by all signed-in users; writes via functions/admin only.
create policy "pools: read" on public.trend_pools for select to authenticated using (true);
create policy "pool_members: read own" on public.pool_members for select using (buyer_id = auth.uid());

-- orders: buyer and the product's supplier can read. No direct writes.
create policy "orders: buyer reads" on public.orders for select using (buyer_id = auth.uid());
create policy "orders: supplier reads" on public.orders for select using (
  exists (select 1 from public.products p where p.id = product_id and p.supplier_id = auth.uid())
);
create policy "escrow_events: read with order" on public.escrow_events for select using (
  exists (select 1 from public.orders o where o.id = order_id
          and (o.buyer_id = auth.uid()
               or exists (select 1 from public.products p where p.id = o.product_id and p.supplier_id = auth.uid())))
);

-- Functions: callable by signed-in users only.
revoke execute on function public.create_trial_order(uuid)              from public, anon;
revoke execute on function public.join_trend_pool(uuid, integer)        from public, anon;
revoke execute on function public.confirm_delivery(uuid)                from public, anon;
revoke execute on function public.open_dispute(uuid, text)              from public, anon;
revoke execute on function public.submit_product_for_review(uuid)       from public, anon;
grant  execute on function public.create_trial_order(uuid)              to authenticated;
grant  execute on function public.join_trend_pool(uuid, integer)        to authenticated;
grant  execute on function public.confirm_delivery(uuid)                to authenticated;
grant  execute on function public.open_dispute(uuid, text)              to authenticated;
grant  execute on function public.submit_product_for_review(uuid)       to authenticated;

-- =============================================================================
-- Storage: product media bucket
-- Path convention: {supplier_id}/{product_id}/{uuid}.{ext}
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', true, 104857600,  -- 100 MB (videos)
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create policy "storage: suppliers upload to own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.current_role_is('supplier')
  );
create policy "storage: suppliers delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "storage: suppliers list own files" on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and (storage.foldername(name))[1] = auth.uid()::text);
