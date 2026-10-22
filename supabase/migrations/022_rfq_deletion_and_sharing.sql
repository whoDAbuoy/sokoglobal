-- =============================================================================
-- SokoGlobal — Migration 022: RFQ deletion and open visibility for sharing.
-- Run after 021. Re-runnable.
--
--  * Buyers can delete their own requests while no quote is accepted
--    (status open / quoted); pending quotes go with them (FK cascade).
--  * Super admins can delete any request, audited as 'rfq.delete'. A request
--    whose quote became an escrow order cannot be deleted by anyone: the order
--    keeps its locked quote (orders.rfq_quote_id is ON DELETE RESTRICT) —
--    cancel or refund the order instead.
--  * Every signed-in user can read live requests (open or quoted, not past the
--    deadline), so suppliers can share /rfqs/<id> with third-party fulfillers.
--    'quoted' stays visible: an RFQ is 'quoted' from its first quote until the
--    buyer decides. Quotes stay private (rfq_quotes RLS is unchanged), and
--    quoting still needs a live listing in the requested category.
-- =============================================================================

-- ── 1. Deletion ─────────────────────────────────────────────────────────────
grant delete on public.rfqs to authenticated;

drop policy if exists "rfqs: buyer deletes unaccepted" on public.rfqs;
create policy "rfqs: buyer deletes unaccepted" on public.rfqs for delete to authenticated
  using (buyer_id = (select auth.uid()) and status in ('open', 'quoted'));

drop policy if exists "rfqs: super admin deletes" on public.rfqs;
create policy "rfqs: super admin deletes" on public.rfqs for delete to authenticated
  using ((select public.is_super_admin()));

-- Clear error instead of a foreign-key failure, and an audit entry when someone other than the buyer deletes.
create or replace function public.guard_rfq_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order uuid;
begin
  select o.id into v_order from public.orders o join public.rfq_quotes q on q.id = o.rfq_quote_id where q.rfq_id = old.id limit 1;
  if v_order is not null then
    raise exception 'This request became order #% — cancel or refund the order instead of deleting the request',
      upper(left(v_order::text, 8)) using errcode = '23503';
  end if;
  if auth.uid() is not null and auth.uid() <> old.buyer_id then
    perform public.write_admin_audit('rfq.delete', 'rfq', old.id::text,
      jsonb_build_object('title', old.title, 'status', old.status, 'buyer_id', old.buyer_id), null, null);
  end if;
  return old;
end $$;
drop trigger if exists rfqs_delete_guard on public.rfqs;
create trigger rfqs_delete_guard before delete on public.rfqs for each row execute function public.guard_rfq_delete();

-- ── 2. Open visibility ──────────────────────────────────────────────────────
drop policy if exists "rfqs: matching suppliers read open" on public.rfqs;
drop policy if exists "rfqs: signed-in users read live" on public.rfqs;
create policy "rfqs: signed-in users read live" on public.rfqs for select to authenticated
  using (status in ('open', 'quoted') and expires_at > now());

-- Supplier lane: every live request (not only matching categories), flagged with whether the caller can quote it.
drop function if exists public.supplier_rfq_feed();
create function public.supplier_rfq_feed()
returns table (
  id uuid, title text, description text, quantity integer, unit_of_measure text, target_price_kes numeric,
  delivery_location text, category_id uuid, category_name text, buyer_country char(2), status text,
  created_at timestamptz, expires_at timestamptz, quote_count integer, my_quote jsonb, can_quote boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.description, r.quantity, r.unit_of_measure, r.target_price_kes, r.delivery_location, r.category_id,
         c.name, b.country_code, r.status, r.created_at, r.expires_at,
         (select count(*)::integer from public.rfq_quotes q where q.rfq_id = r.id),
         (select to_jsonb(q) - 'supplier_id' from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid()),
         public.rfq_matches_supplier(r.category_id, auth.uid())
    from public.rfqs r
    join public.profiles b on b.id = r.buyer_id
    left join public.categories c on c.id = r.category_id
   where public.current_role_is('supplier') and r.buyer_id <> auth.uid()
     and ((r.status in ('open', 'quoted') and r.expires_at > now())
          or exists (select 1 from public.rfq_quotes q where q.rfq_id = r.id and q.supplier_id = auth.uid()))
   order by (r.status in ('open', 'quoted') and r.expires_at > now()) desc,
            public.rfq_matches_supplier(r.category_id, auth.uid()) desc, r.created_at desc
   limit 200
$$;
revoke all on function public.supplier_rfq_feed() from public, anon;
grant execute on function public.supplier_rfq_feed() to authenticated;
