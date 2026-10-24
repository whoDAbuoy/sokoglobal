-- =============================================================================
-- SokoGlobal — Migration 030: follow suppliers. Run after 029. Re-runnable.
--
--  * public.follows: one row per (follower, supplier). Anyone signed in can
--    follow a supplier account (never themselves, never a banned account) and
--    reads / removes only their own rows. There is no UPDATE.
--  * Suppliers never see who follows them: supplier_follower_count() returns
--    the number only.
--  * The buyer's "From suppliers you follow" feed reads live products through
--    the existing "products: read live" policy; drafts stay private.
-- =============================================================================

create table if not exists public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
-- Counts and the feed look up by supplier; the primary key already covers "who do I follow".
create index if not exists follows_following_idx on public.follows (following_id);

alter table public.follows enable row level security;
drop policy if exists "follows: read own"   on public.follows;
drop policy if exists "follows: create own" on public.follows;
drop policy if exists "follows: delete own" on public.follows;
create policy "follows: read own" on public.follows for select to authenticated
  using (follower_id = (select auth.uid()));
create policy "follows: create own" on public.follows for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and exists (select 1 from public.profiles p
                 where p.id = following_id and p.role = 'supplier' and not coalesce(p.is_banned, false))
  );
create policy "follows: delete own" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

-- Public follower count for a supplier profile (a number, never identities).
create or replace function public.supplier_follower_count(p_supplier_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.follows where following_id = p_supplier_id
$$;
revoke all on function public.supplier_follower_count(uuid) from public, anon;
grant execute on function public.supplier_follower_count(uuid) to authenticated;
