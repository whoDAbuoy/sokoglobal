-- =============================================================================
-- SokoGlobal — Migration 027: suppliers delete their own drafts. Run after 026.
-- Re-runnable.
--
--  * A supplier may hard-delete a product of theirs that is a draft, was never
--    removed by SokoGlobal, and has no history: no orders, no Trend Pools and
--    no RFQ quotes. (A listing an admin sent back to 'draft' can have orders;
--    those stay — orders.product_id is ON DELETE RESTRICT so escrow keeps its
--    product.) Media rows cascade; the app removes the files from storage.
--  * delete_supplier_draft() is the supported path (clear errors, returns the
--    storage paths). The RLS DELETE policy applies the same rule to a direct
--    DELETE. Every hard delete is written to moderation_log by the trigger
--    from migration 006, with the supplier as actor.
-- =============================================================================

create index if not exists products_supplier_drafts_idx on public.products (supplier_id, updated_at desc)
  where status = 'draft' and deleted_at is null;

-- Why a supplier may not delete this product (null = they may). SECURITY DEFINER: orders and pools
-- of other buyers are not visible to the supplier under RLS.
create or replace function public.supplier_draft_delete_block(p_product_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.id is null or p.supplier_id is distinct from auth.uid() then 'Draft not found'
    when p.deleted_at is not null then 'This listing was removed by SokoGlobal and is kept for the record'
    when p.status <> 'draft' then 'Only drafts can be deleted (this listing is ' || replace(p.status::text, '_', ' ') || ')'
    when exists (select 1 from public.orders o where o.product_id = p.id) then 'This listing has orders, so it is kept for the order history'
    when exists (select 1 from public.trend_pools t where t.product_id = p.id) then 'This listing has a Trend Pool, so it is kept'
    when exists (select 1 from public.rfq_quotes q where q.product_id = p.id) then 'Withdraw your quotes that use this listing first'
  end
  from (select 1) one left join public.products p on p.id = p_product_id
$$;

drop policy if exists "products: supplier deletes own drafts" on public.products;
create policy "products: supplier deletes own drafts" on public.products for delete to authenticated
  using (supplier_id = (select auth.uid()) and status = 'draft' and public.supplier_draft_delete_block(id) is null);
grant delete on public.products to authenticated;

-- Returns { deleted: true, storage_paths: text[] }; the caller removes those files from the product-media bucket.
create or replace function public.delete_supplier_draft(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_block text; v_paths text[];
begin
  if not public.current_role_is('supplier') then raise exception 'Supplier access required' using errcode = '42501'; end if;
  perform 1 from public.products where id = p_product_id and supplier_id = auth.uid() for update;
  v_block := public.supplier_draft_delete_block(p_product_id);
  if v_block is not null then
    raise exception '%', v_block using errcode = case when v_block = 'Draft not found' then 'P0002' else '55000' end;
  end if;
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into v_paths
    from public.product_media where product_id = p_product_id;
  perform set_config('sokoglobal.deletion_reason', 'Draft deleted by supplier', true);
  delete from public.products where id = p_product_id;
  return jsonb_build_object('deleted', true, 'storage_paths', to_jsonb(v_paths));
end $$;

revoke all on function public.supplier_draft_delete_block(uuid) from public, anon;
grant execute on function public.supplier_draft_delete_block(uuid) to authenticated;
revoke all on function public.delete_supplier_draft(uuid) from public, anon;
grant execute on function public.delete_supplier_draft(uuid) to authenticated;
