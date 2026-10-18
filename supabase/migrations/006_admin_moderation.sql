-- =============================================================================
-- SokoGlobal — Migration 006: admin moderation (product removal).
-- Run after 005. Re-runnable.
--
-- Hard vs soft delete
--   * A product nobody has ever ordered or pooled on is HARD-deleted: the row
--     and its product_media rows go, and the app removes the storage files.
--   * A product referenced by orders / trend pools is SOFT-deleted (archived +
--     deleted_at). orders.product_id and trend_pools.product_id are ON DELETE
--     RESTRICT on purpose: escrow, payouts, disputes and refunds must keep
--     pointing at what the buyer paid for.
--   * Orders, escrow events, payouts, pledges and payment events are financial
--     records and are never deletable through the API — not even by admins.
--   Either way a snapshot is written to moderation_log.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Soft-delete columns. A removed product is archived for good: no policy or
--    function moves a product out of 'archived'.
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid references public.profiles (id) on delete set null,
  add column if not exists deletion_reason text check (char_length(deletion_reason) <= 2000);
create index if not exists products_deleted_idx on public.products (deleted_at desc) where deleted_at is not null;

alter table public.products drop constraint if exists deleted_is_archived;
alter table public.products add constraint deleted_is_archived check (deleted_at is null or status = 'archived');

-- ---------------------------------------------------------------------------
-- B. Append-only moderation audit log (admin read; written only by functions
--    and triggers below).
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_log (
  id          bigint generated always as identity primary key,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null check (action in ('hard_delete', 'soft_delete')),
  actor_id    uuid references public.profiles (id) on delete set null,  -- null = service role / cascade
  reason      text,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists moderation_log_entity_idx on public.moderation_log (entity_type, entity_id, created_at desc);
alter table public.moderation_log enable row level security;
drop policy if exists "moderation_log: admin reads" on public.moderation_log;
create policy "moderation_log: admin reads" on public.moderation_log for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.moderation_log from authenticated, anon;

-- Log every hard delete of a product, whichever path it came through (the
-- admin function, a direct DELETE under the admin RLS policy, or a profile
-- cascade). BEFORE DELETE so the media rows are still there to snapshot; if the
-- delete fails (e.g. FK restrict) the log row rolls back with it.
create or replace function public.log_product_hard_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.moderation_log (entity_type, entity_id, action, actor_id, reason, snapshot)
  values ('product', old.id, 'hard_delete', auth.uid(),
          nullif(current_setting('sokoglobal.deletion_reason', true), ''),
          to_jsonb(old) || jsonb_build_object('media', coalesce(
            (select jsonb_agg(to_jsonb(m)) from public.product_media m where m.product_id = old.id), '[]'::jsonb)));
  return old;
end $$;
revoke execute on function public.log_product_hard_delete() from public, anon, authenticated;

drop trigger if exists products_log_hard_delete on public.products;
create trigger products_log_hard_delete before delete on public.products
  for each row execute function public.log_product_hard_delete();

-- ---------------------------------------------------------------------------
-- C. DELETE policies
-- ---------------------------------------------------------------------------
-- Financial tables: drop any DELETE policy that may have been added by hand,
-- and remove the privilege outright. Only service_role (which bypasses RLS)
-- can ever delete these rows.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and cmd = 'DELETE'
       and tablename in ('orders', 'escrow_events', 'payouts', 'payment_events', 'pool_members', 'trend_pools')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
revoke delete on public.orders, public.escrow_events, public.payouts, public.payment_events,
                  public.pool_members, public.trend_pools
  from authenticated, anon;

-- products: admins only. FK restrict still blocks deleting anything with
-- orders/pools, and the trigger above audits every delete.
drop policy if exists "products: admin deletes" on public.products;
create policy "products: admin deletes" on public.products for delete to authenticated
  using ((select public.current_role_is('admin')));

-- product_media: admins, plus the existing supplier policy for their own drafts.
drop policy if exists "media: admin deletes" on public.product_media;
create policy "media: admin deletes" on public.product_media for delete to authenticated
  using ((select public.current_role_is('admin')));

-- Storage (product-media bucket). Supabase's remove() needs SELECT + DELETE.
drop policy if exists "storage: admin reads product media"   on storage.objects;
drop policy if exists "storage: admin deletes product media" on storage.objects;
create policy "storage: admin reads product media" on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and (select public.current_role_is('admin')));
create policy "storage: admin deletes product media" on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and (select public.current_role_is('admin')));

-- Tighten the supplier policy: it was path-only, so a supplier could delete
-- the photos behind a live (or ordered, or removed) product. Now only files
-- not attached to a non-draft product are deletable by their owner.
alter policy "storage: suppliers delete own files" on storage.objects using (
  bucket_id = 'product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1 from public.product_media m join public.products p on p.id = m.product_id
     where m.storage_path = objects.name and p.status <> 'draft'
  )
);

-- ---------------------------------------------------------------------------
-- D. Buyers keep seeing products they have ordered, even once archived, so
--    order history and escrow pages keep their titles. SECURITY DEFINER avoids
--    RLS recursion (the orders policies already read products).
-- ---------------------------------------------------------------------------
create or replace function public.has_ordered_product(p_product_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders where product_id = p_product_id and buyer_id = auth.uid())
      or exists (select 1 from public.pool_members m join public.trend_pools t on t.id = m.pool_id
                  where t.product_id = p_product_id and m.buyer_id = auth.uid())
$$;
revoke execute on function public.has_ordered_product(uuid) from public, anon;
grant  execute on function public.has_ordered_product(uuid) to authenticated;

drop policy if exists "products: buyer reads ordered" on public.products;
create policy "products: buyer reads ordered" on public.products for select to authenticated
  using (public.has_ordered_product(id));

-- ---------------------------------------------------------------------------
-- E. admin_remove_product(): the supported removal path.
--    Returns { mode: 'deleted' | 'archived', storage_paths: text[],
--              cancelled_pools, cancelled_orders, open_orders }.
--    The caller removes storage_paths from the bucket after a hard delete.
-- ---------------------------------------------------------------------------
create or replace function public.admin_remove_product(p_product_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason   text := left(trim(coalesce(p_reason, '')), 2000);
  v_product  public.products;
  v_paths    text[];
  v_pool_ids uuid[];
  v_cancelled_orders integer;
  v_open_orders      integer;
begin
  if not public.current_role_is('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Give a reason (10+ characters) — it is kept in the audit log and shown to the supplier';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if v_product.deleted_at is not null then raise exception 'This product was already removed'; end if;

  -- Never touched by money → hard delete. product_media cascades.
  if not exists (select 1 from public.orders      where product_id = p_product_id)
     and not exists (select 1 from public.trend_pools where product_id = p_product_id) then
    select coalesce(array_agg(storage_path), '{}') into v_paths
      from public.product_media where product_id = p_product_id;
    perform set_config('sokoglobal.deletion_reason', v_reason, true);
    delete from public.products where id = p_product_id;
    return jsonb_build_object('mode', 'deleted', 'storage_paths', to_jsonb(v_paths),
                              'cancelled_pools', 0, 'cancelled_orders', 0, 'open_orders', 0);
  end if;

  -- Referenced → archive. It drops out of the catalogue ("products: read live")
  -- and can no longer be ordered (create_trial_order requires 'live').
  update public.products
     set status = 'archived', deleted_at = now(), deleted_by = auth.uid(), deletion_reason = v_reason
   where id = p_product_id
  returning * into v_product;

  -- Stop pools still raising money; same treatment as expire_due_pools():
  -- unpaid pledges are cancelled, paid ones are queued for the refund cron.
  with cancelled as (
    update public.trend_pools set status = 'cancelled'
     where product_id = p_product_id and status in ('open', 'funded')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_pool_ids from cancelled;

  update public.pool_members set payment_status = 'cancelled'
   where pool_id = any (v_pool_ids) and payment_status = 'pending_payment';
  update public.pool_members set refund_status = 'pending'
   where pool_id = any (v_pool_ids) and payment_status = 'funded' and refund_status is null;

  -- Cancel unpaid orders that never started checkout: no tx_ref was ever
  -- issued, so no payment can land later. Orders with a checkout attempt are
  -- left for ops — a payment could still be in flight.
  update public.orders set escrow_status = 'cancelled'
   where product_id = p_product_id and escrow_status = 'pending_payment' and payment_attempts = 0;
  get diagnostics v_cancelled_orders = row_count;

  select count(*) into v_open_orders from public.orders
   where product_id = p_product_id
     and escrow_status in ('pending_payment', 'funded', 'in_transit', 'customs_cleared',
                           'delivered_pending_verification', 'disputed');

  insert into public.moderation_log (entity_type, entity_id, action, actor_id, reason, snapshot)
  values ('product', p_product_id, 'soft_delete', auth.uid(), v_reason,
          to_jsonb(v_product) || jsonb_build_object('cancelled_pool_ids', to_jsonb(v_pool_ids)));

  return jsonb_build_object('mode', 'archived', 'storage_paths', '[]'::jsonb,
                            'cancelled_pools', coalesce(array_length(v_pool_ids, 1), 0),
                            'cancelled_orders', v_cancelled_orders, 'open_orders', v_open_orders);
end $$;

revoke execute on function public.admin_remove_product(uuid, text) from public, anon;
grant  execute on function public.admin_remove_product(uuid, text) to authenticated;
