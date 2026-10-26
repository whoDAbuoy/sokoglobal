-- =============================================================================
-- SokoGlobal — Migration 032: supplier star ratings. Run after 031. Re-runnable.
--
--  * public.supplier_ratings: one 1–5 star rating per (buyer, supplier), optional short comment.
--    A buyer may rate a supplier only after at least one of their orders for that supplier's
--    products has been released from escrow (goods verified). They read, change or remove only
--    their own rating.
--  * supplier_rating(id): the public average (2 decimals) and count for any signed-in user —
--    never who rated what.
--  * can_rate_supplier(id): whether the caller may rate that supplier (drives the UI; the RLS
--    policies below are what actually enforce it).
-- =============================================================================

create table if not exists public.supplier_ratings (
  buyer_id    uuid not null references auth.users (id) on delete cascade,
  supplier_id uuid not null references auth.users (id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (buyer_id, supplier_id),
  constraint supplier_ratings_not_self check (buyer_id <> supplier_id)
);
create index if not exists supplier_ratings_supplier_idx on public.supplier_ratings (supplier_id);

-- Has the caller had an order for this supplier's goods released from escrow?
create or replace function public.can_rate_supplier(p_supplier_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.orders o join public.products pr on pr.id = o.product_id
     where o.buyer_id = auth.uid() and pr.supplier_id = p_supplier_id and o.escrow_status = 'released'
  )
$$;
revoke all on function public.can_rate_supplier(uuid) from public, anon;
grant execute on function public.can_rate_supplier(uuid) to authenticated;

alter table public.supplier_ratings enable row level security;
drop policy if exists "ratings: read own"   on public.supplier_ratings;
drop policy if exists "ratings: create own" on public.supplier_ratings;
drop policy if exists "ratings: update own" on public.supplier_ratings;
drop policy if exists "ratings: delete own" on public.supplier_ratings;
create policy "ratings: read own" on public.supplier_ratings for select to authenticated
  using (buyer_id = (select auth.uid()));
create policy "ratings: create own" on public.supplier_ratings for insert to authenticated
  with check (buyer_id = (select auth.uid()) and public.can_rate_supplier(supplier_id));
create policy "ratings: update own" on public.supplier_ratings for update to authenticated
  using (buyer_id = (select auth.uid()))
  with check (buyer_id = (select auth.uid()) and public.can_rate_supplier(supplier_id));
create policy "ratings: delete own" on public.supplier_ratings for delete to authenticated
  using (buyer_id = (select auth.uid()));
revoke all on public.supplier_ratings from anon, authenticated;
grant select, insert, delete on public.supplier_ratings to authenticated;
grant update (stars, comment, updated_at) on public.supplier_ratings to authenticated;

drop trigger if exists supplier_ratings_touch on public.supplier_ratings;
create trigger supplier_ratings_touch before update on public.supplier_ratings
  for each row execute function public.touch_updated_at();

-- Public aggregate: average stars (2 decimals, null when unrated) and number of ratings.
drop function if exists public.supplier_rating(uuid);
create function public.supplier_rating(p_supplier_id uuid)
returns table (average numeric, ratings integer)
language sql stable security definer set search_path = public as $$
  select round(avg(stars)::numeric, 2), count(*)::integer
    from public.supplier_ratings where supplier_id = p_supplier_id and auth.uid() is not null
$$;
revoke all on function public.supplier_rating(uuid) from public, anon;
grant execute on function public.supplier_rating(uuid) to authenticated;
