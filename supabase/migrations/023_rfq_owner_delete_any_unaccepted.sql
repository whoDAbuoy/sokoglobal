-- =============================================================================
-- SokoGlobal — Migration 023: buyers can delete any of their own requests that
-- has no accepted quote (open, quoted, closed or expired). Run after 022.
-- Re-runnable.
--
-- 022 only allowed open / quoted, so closed and expired requests could never be
-- cleaned up. Accepted requests stay undeletable: their quote is the locked
-- terms of an escrow order (guard_rfq_delete() in 022 refuses that for anyone,
-- super admins included).
-- =============================================================================

drop policy if exists "rfqs: buyer deletes unaccepted" on public.rfqs;
create policy "rfqs: buyer deletes unaccepted" on public.rfqs for delete to authenticated
  using (buyer_id = (select auth.uid()) and status <> 'accepted');
