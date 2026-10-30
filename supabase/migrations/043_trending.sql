-- =============================================================================
-- SokoGlobal — Migration 043: trending products and Trend Pools (the /dashboard/pools page). Run after 042.
-- Re-runnable.
--
--  * product_interactions: product views (Quick View opened) and wishlist saves, at most one row per
--    buyer, product, kind and day. Written only through track_product_interaction() for a live
--    listing by a signed-in account that is not the listing's supplier. No direct reads or writes
--    (RLS on, no policies): only the aggregate functions below see it. Rows older than 90 days are
--    removed by prune_product_interactions() (called from the existing daily cron).
--  * trending_products(p_days, p_limit): live listings ranked by recent buyer activity. Each signal
--    has a weight, and newer activity counts more (half-life 3 days):
--        paid order 8 · Trend Pool pledge 6 · inquiry to the supplier 4 · wishlist save 3 · view 1
--    The supplier's own activity never counts, banned suppliers are left out, and only aggregate
--    counts leave the database (never who interacted).
--  * trending_pools(p_limit): open / funded pools ranked by recent pledges (same decay), plus the
--    trending score of the pool's product, so a pool on a hot product rises with it.
-- =============================================================================

create table if not exists public.product_interactions (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('view', 'save')),
  day        date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (product_id, user_id, kind, day)
);
create index if not exists product_interactions_recent_idx on public.product_interactions (created_at desc, product_id);
alter table public.product_interactions enable row level security;
revoke all on public.product_interactions from public, anon, authenticated;
-- Same rule as every other table since 042 (no policies grant access here anyway).
drop policy if exists "two-factor: verified sessions only" on public.product_interactions;
create policy "two-factor: verified sessions only" on public.product_interactions as restrictive for all to authenticated
  using ((select public.two_factor_satisfied())) with check ((select public.two_factor_satisfied()));

create or replace function public.track_product_interaction(p_product_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_kind not in ('view', 'save') then raise exception 'Unknown interaction %', p_kind; end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.status = 'live' and p.deleted_at is null
                   and p.supplier_id <> v_uid) then
    return false;
  end if;
  insert into public.product_interactions (product_id, user_id, kind) values (p_product_id, v_uid, p_kind)
  on conflict do nothing;
  return true;
end $$;
revoke all on function public.track_product_interaction(uuid, text) from public, anon;
grant execute on function public.track_product_interaction(uuid, text) to authenticated;

create or replace function public.prune_product_interactions()
returns integer language sql security definer set search_path = public as $$
  with gone as (delete from public.product_interactions where created_at < now() - interval '90 days' returning 1)
  select count(*)::integer from gone
$$;
revoke all on function public.prune_product_interactions() from public, anon, authenticated;
grant execute on function public.prune_product_interactions() to service_role;

-- Weight of one event that happened at p_at: p_weight halved every 3 days.
create or replace function public.trend_decay(p_weight numeric, p_at timestamptz)
returns numeric language sql stable as $$
  select p_weight * power(0.5, greatest(0, extract(epoch from (now() - p_at))) / 259200.0)
$$;

drop function if exists public.trending_products(integer, integer);
create function public.trending_products(p_days integer default 14, p_limit integer default 12)
returns table (product_id uuid, score numeric, buyers integer, orders integer, pledges integer, inquiries integer, saves integer, views integer)
language sql stable security definer set search_path = public as $$
  with live as (
    select p.id, p.supplier_id from public.products p
      join public.profiles s on s.id = p.supplier_id and not coalesce(s.is_banned, false)
     where p.status = 'live' and p.deleted_at is null
  ), since as (select now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60)) as t),
  events as (
    select o.product_id, o.buyer_id as user_id, 'order'::text as kind, o.created_at as at, 8::numeric as w
      from public.orders o, since where o.created_at >= since.t and o.escrow_status::text not in ('pending_payment', 'cancelled')
    union all
    select tp.product_id, m.buyer_id, 'pledge', m.joined_at, 6 from public.pool_members m
      join public.trend_pools tp on tp.id = m.pool_id, since where m.joined_at >= since.t
    union all
    select t.product_id, t.buyer_id, 'inquiry', t.created_at, 4 from public.chat_threads t, since
     where t.product_id is not null and t.created_at >= since.t
    union all
    select i.product_id, i.user_id, i.kind, i.created_at, case i.kind when 'save' then 3 else 1 end
      from public.product_interactions i, since where i.created_at >= since.t
  )
  select e.product_id,
         round(sum(public.trend_decay(e.w, e.at)), 3),
         count(distinct e.user_id)::integer,
         count(*) filter (where e.kind = 'order')::integer,
         count(*) filter (where e.kind = 'pledge')::integer,
         count(*) filter (where e.kind = 'inquiry')::integer,
         count(*) filter (where e.kind = 'save')::integer,
         count(*) filter (where e.kind = 'view')::integer
    from events e join live l on l.id = e.product_id
   where e.user_id <> l.supplier_id
   group by e.product_id
   order by 2 desc, e.product_id
   limit least(greatest(coalesce(p_limit, 12), 1), 48)
$$;
revoke all on function public.trending_products(integer, integer) from public, anon;
grant execute on function public.trending_products(integer, integer) to authenticated;

drop function if exists public.trending_pools(integer);
create function public.trending_pools(p_limit integer default 24)
returns table (pool_id uuid, score numeric, recent_pledges integer)
language sql stable security definer set search_path = public as $$
  with hot as (select t.product_id, t.score from public.trending_products(14, 48) t)
  select tp.id,
         round(coalesce(sum(public.trend_decay(6, m.joined_at)) filter (where m.joined_at >= now() - interval '14 days'), 0)
               + 0.5 * coalesce(max(h.score), 0), 3),
         (count(m.buyer_id) filter (where m.joined_at >= now() - interval '7 days'))::integer
    from public.trend_pools tp
    left join public.pool_members m on m.pool_id = tp.id
    left join hot h on h.product_id = tp.product_id
   where tp.status::text in ('open', 'funded')
   group by tp.id
   order by 2 desc, tp.id
   limit least(greatest(coalesce(p_limit, 24), 1), 100)
$$;
revoke all on function public.trending_pools(integer) from public, anon;
grant execute on function public.trending_pools(integer) to authenticated;
