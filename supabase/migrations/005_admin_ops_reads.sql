-- =============================================================================
-- SokoGlobal — Migration 005: ops read access for the admin tracking UI.
-- Run after 004. Re-runnable.
--
-- Writes still go only through admin_set_shipment_tracking() (role re-checked
-- inside the function); these policies add READ access for admins.
-- =============================================================================

drop policy if exists "orders: admin reads" on public.orders;
create policy "orders: admin reads" on public.orders for select to authenticated
  using ((select public.current_role_is('admin')));

drop policy if exists "escrow_events: admin reads" on public.escrow_events;
create policy "escrow_events: admin reads" on public.escrow_events for select to authenticated
  using ((select public.current_role_is('admin')));

-- Admin order queue: shipments that ops still need to move along.
create index if not exists orders_ops_queue_idx on public.orders (escrow_status, created_at desc)
  where escrow_status in ('funded', 'in_transit', 'customs_cleared', 'delivered_pending_verification');

-- Reconciliation scan: processing payouts by age.
create index if not exists payouts_processing_age_idx on public.payouts (updated_at)
  where status = 'processing';
