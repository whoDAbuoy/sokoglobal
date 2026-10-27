-- =============================================================================
-- SokoGlobal — Migration 035: one call for the "Suppliers you follow" cards. Run after 034. Re-runnable.
--
-- /dashboard/following used to make four calls per followed supplier — public_profile() (031),
-- supplier_rating() and can_rate_supplier() (032) and supplier_follower_count() (030) — so 50 followed
-- suppliers cost 200 round trips. followed_suppliers_overview(ids) returns the same values for up to
-- 200 suppliers in one call, with the same rules:
--  * only importer / supplier accounts that aren't banned, and only for a signed-in caller (public_profile);
--  * rating = average stars to 2 decimals (null when unrated) and the number of ratings, never who rated;
--  * can_rate = can_rate_supplier() for the caller (a released order from that supplier).
-- =============================================================================

drop function if exists public.followed_suppliers_overview(uuid[]);
create function public.followed_suppliers_overview(p_ids uuid[])
returns table (
  id uuid, bio text, follower_count integer, following_count integer, live_listings integer,
  rating_average numeric, rating_count integer, can_rate boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.bio,
         (select count(*)::integer from public.follows f where f.following_id = p.id),
         (select count(*)::integer from public.follows f where f.follower_id = p.id),
         (select count(*)::integer from public.products pr where pr.supplier_id = p.id and pr.status = 'live' and pr.deleted_at is null),
         (select round(avg(r.stars)::numeric, 2) from public.supplier_ratings r where r.supplier_id = p.id),
         (select count(*)::integer from public.supplier_ratings r where r.supplier_id = p.id),
         public.can_rate_supplier(p.id)
    from public.profiles p
   where p.id = any (p_ids)
     and cardinality(p_ids) <= 200
     and p.role in ('importer', 'supplier')
     and not coalesce(p.is_banned, false)
     and auth.uid() is not null
$$;
revoke all on function public.followed_suppliers_overview(uuid[]) from public, anon;
grant execute on function public.followed_suppliers_overview(uuid[]) to authenticated;
