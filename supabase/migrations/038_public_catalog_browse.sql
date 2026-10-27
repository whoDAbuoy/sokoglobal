-- =============================================================================
-- SokoGlobal — Migration 038: public catalogue browsing and readable URLs. Run after 037. Re-runnable.
--
-- Google's SEO starter guide: pages should be reachable through links (not only the sitemap) and URLs
-- should describe the page. So:
--  * public_browse_listings(limit, offset): live listings newest first, a page at a time (max 48),
--    with the total, for the public /products index that the landing page links to. Same visibility
--    rules and columns as public_listings() (migration 036).
--  * public_sitemap_entries(): now also returns each page's name (listing title / company name),
--    so sitemap URLs carry the same readable slug as the pages (/products/steel-kettle-<id>).
-- =============================================================================

drop function if exists public.public_browse_listings(integer, integer);
create function public.public_browse_listings(p_limit integer default 24, p_offset integer default 0)
returns table (id uuid, title text, origin_country text, landed_cost_cents integer, trial_units integer,
  image_url text, supplier_id uuid, supplier_company text, supplier_verified boolean, created_at timestamptz, total integer)
language sql stable security definer set search_path = public as $$
  with live as (
    select p.*, s.company_name, s.kyc_verified
      from public.products p
      join public.profiles s on s.id = p.supplier_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
     where p.status = 'live' and p.deleted_at is null
  )
  select l.id, l.title, l.origin_country::text, l.trial_landed_cost_cents, l.trial_units,
         (select m.public_url from public.product_media m
           where m.product_id = l.id and m.media_type = 'image' and m.public_url is not null order by m.sort_order, m.id limit 1),
         l.supplier_id, l.company_name, l.kyc_verified, l.created_at,
         (select count(*)::integer from live)
    from live l
   order by l.created_at desc, l.id
   limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset least(greatest(coalesce(p_offset, 0), 0), 100000)
$$;

-- Return type changes (adds "name"): drop and recreate.
drop function if exists public.public_sitemap_entries(integer);
create function public.public_sitemap_entries(p_limit integer default 45000)
returns table (kind text, id uuid, last_modified timestamptz, name text)
language sql stable security definer set search_path = public as $$
  (select 'product'::text, p.id, p.updated_at, p.title
     from public.products p
     join public.profiles s on s.id = p.supplier_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
    where p.status = 'live' and p.deleted_at is null
    order by p.updated_at desc
    limit least(greatest(coalesce(p_limit, 45000), 1), 45000))
  union all
  (select 'supplier'::text, s.id, greatest(s.updated_at, max(p.updated_at)), s.company_name
     from public.profiles s
     join public.products p on p.supplier_id = s.id and p.status = 'live' and p.deleted_at is null
    where s.role = 'supplier' and not coalesce(s.is_banned, false)
    group by s.id, s.updated_at, s.company_name
    order by 3 desc
    limit least(greatest(coalesce(p_limit, 45000), 1), 45000))
$$;

do $$
declare f text;
begin
  foreach f in array array['public.public_browse_listings(integer, integer)', 'public.public_sitemap_entries(integer)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
