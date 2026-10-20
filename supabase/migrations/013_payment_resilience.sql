-- =============================================================================
-- SokoGlobal — Migration 013: payment resilience. Run after 012. Re-runnable.
--
--  * Dead-letter queue for webhooks: payment_events rows that were logged but
--    never processed (the handler hit a transient error) are retried by
--    /api/cron/retry-webhooks with exponential backoff; after MAX attempts they
--    are dead-lettered for a human (admin → Reconciliation).
--  * Daily escrow reconciliation: /api/cron/reconcile-escrow compares local
--    escrow (orders, card_payments, mpesa_payments) with Paystack / Daraja and
--    records each run and every discrepancy. Admin-readable, service-role written.
-- =============================================================================

-- ── 1. Dead-letter columns on the webhook log ───────────────────────────────
alter table public.payment_events add column if not exists attempts         integer not null default 0;
alter table public.payment_events add column if not exists last_error       text;
alter table public.payment_events add column if not exists next_retry_at    timestamptz;
alter table public.payment_events add column if not exists dead_lettered_at timestamptz;
create index if not exists payment_events_retry_idx on public.payment_events (next_retry_at nulls first, received_at)
  where processed_at is null and dead_lettered_at is null;
create index if not exists payment_events_dead_idx on public.payment_events (dead_lettered_at desc) where dead_lettered_at is not null;

-- ── 2. Reconciliation runs + issues ─────────────────────────────────────────
create table if not exists public.escrow_recon_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'issues', 'failed')),
  window_from  timestamptz not null,
  window_to    timestamptz not null,
  summary      jsonb not null default '{}'::jsonb,
  triggered_by text not null default 'cron'      -- 'cron' or 'admin:<uuid>'
);
create index if not exists escrow_recon_runs_started_idx on public.escrow_recon_runs (started_at desc);

create table if not exists public.escrow_recon_issues (
  id          bigint generated always as identity primary key,
  run_id      uuid not null references public.escrow_recon_runs (id) on delete cascade,
  severity    text not null check (severity in ('critical', 'warning')),
  kind        text not null,
  provider    text,
  reference   text,
  order_id    uuid,
  message     text not null,
  expected    jsonb,
  actual      jsonb,
  fingerprint text not null,             -- same problem on later runs → same fingerprint
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution  text
);
create index if not exists escrow_recon_issues_open_idx on public.escrow_recon_issues (severity, created_at desc) where resolved_at is null;
create index if not exists escrow_recon_issues_fp_idx on public.escrow_recon_issues (fingerprint) where resolved_at is null;

alter table public.escrow_recon_runs   enable row level security;
alter table public.escrow_recon_issues enable row level security;
drop policy if exists "recon_runs: admin reads"   on public.escrow_recon_runs;
drop policy if exists "recon_issues: admin reads" on public.escrow_recon_issues;
create policy "recon_runs: admin reads" on public.escrow_recon_runs for select to authenticated
  using ((select public.current_role_is('admin')));
create policy "recon_issues: admin reads" on public.escrow_recon_issues for select to authenticated
  using ((select public.current_role_is('admin')));
revoke insert, update, delete on public.escrow_recon_runs, public.escrow_recon_issues from authenticated, anon;

-- Mark an issue resolved (admin only; role re-checked here).
create or replace function public.admin_resolve_recon_issue(p_issue_id bigint, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'Describe how it was resolved (5+ characters)'; end if;
  update public.escrow_recon_issues
     set resolved_at = now(), resolved_by = auth.uid(), resolution = left(btrim(p_resolution), 1000)
   where id = p_issue_id and resolved_at is null;
  if not found then raise exception 'Issue not found or already resolved'; end if;
end $$;
revoke all on function public.admin_resolve_recon_issue(bigint, text) from public, anon;
grant execute on function public.admin_resolve_recon_issue(bigint, text) to authenticated;

-- Requeue a dead-lettered webhook (admin only).
create or replace function public.admin_requeue_payment_event(p_event_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  update public.payment_events set dead_lettered_at = null, attempts = 0, next_retry_at = now(), last_error = null
   where id = p_event_id and processed_at is null;
  if not found then raise exception 'Event not found or already processed'; end if;
end $$;
revoke all on function public.admin_requeue_payment_event(bigint) from public, anon;
grant execute on function public.admin_requeue_payment_event(bigint) to authenticated;
