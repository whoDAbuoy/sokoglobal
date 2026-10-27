-- =============================================================================
-- SokoGlobal — Migration 036: public product and supplier pages. Run after 035. Re-runnable.
--
-- Search engines and AI crawlers only index pages anyone can open, so live listings and supplier
-- profiles get public pages (/products/[id], /suppliers/[id]) plus a sitemap. Signed-out visitors
-- read them ONLY through the functions below; table RLS is unchanged ("products: read live" and
-- "profiles: read suppliers" stay authenticated-only), so anon can't select arbitrary columns.
--
-- What becomes public, and only for live, non-deleted listings of suppliers who aren't banned:
--  * listing: title, brand, description, category, origin, specs (attributes), trial units, MOQ,
--    unit of measure, landed cost and unit price (USD cents), lead time, photos, dates;
--  * supplier: company name, country, KYC-verified flag, Gold flag, avatar, bio, member since,
--    rating average / count, live listing count.
-- Never exposed: personal names, contact details, review notes, reviewer, SKU, deletion data,
-- the platform freight markup, RFQ price tiers, or anything about buyers and orders.
-- =============================================================================

-- One live listing with its supplier, for /products/[id]. No row = not public (draft, removed, banned supplier).
drop function if exists public.public_listing(uuid);
create function public.public_listing(p_id uuid)
returns table (
  id uuid, title text, brand text, description text, category text, category_id uuid, category_name text,
  origin_country text, attributes jsonb, trial_units integer, moq integer, unit_of_measure text,
  unit_price_cents integer, landed_cost_cents integer, lead_time_days integer, images text[],
  created_at timestamptz, updated_at timestamptz,
  supplier_id uuid, supplier_company text, supplier_country text, supplier_verified boolean, supplier_gold boolean,
  supplier_avatar_url text, rating_average numeric, rating_count integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.brand, p.description, p.category::text, p.category_id, c.name,
         p.origin_country::text, coalesce(p.attributes, '{}'::jsonb), p.trial_units, p.moq, p.unit_of_measure,
         p.unit_price_cents, p.trial_landed_cost_cents, p.lead_time_days,
         coalesce((select array_agg(m.public_url order by m.sort_order, m.id) from public.product_media m
                    where m.product_id = p.id and m.media_type = 'image' and m.public_url is not null), '{}'),
         p.created_at, p.updated_at,
         s.id, s.company_name, s.country_code::text, s.kyc_verified, public.is_gold_supplier(s.id), s.avatar_url,
         (select round(avg(r.stars)::numeric, 2) from public.supplier_ratings r where r.supplier_id = s.id),
         (select count(*)::integer from public.supplier_ratings r where r.supplier_id = s.id)
    from public.products p
    join public.profiles s on s.id = p.supplier_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
    left join public.categories c on c.id = p.category_id
   where p.id = p_id and p.status = 'live' and p.deleted_at is null
$$;

-- A supplier's public profile, for /suppliers/[id].
drop function if exists public.public_supplier(uuid);
create function public.public_supplier(p_id uuid)
returns table (
  id uuid, company_name text, country_code text, kyc_verified boolean, gold boolean, avatar_url text, bio text,
  created_at timestamptz, updated_at timestamptz, rating_average numeric, rating_count integer, live_listings integer
)
language sql stable security definer set search_path = public as $$
  select s.id, s.company_name, s.country_code::text, s.kyc_verified, public.is_gold_supplier(s.id), s.avatar_url, s.bio,
         s.created_at, s.updated_at,
         (select round(avg(r.stars)::numeric, 2) from public.supplier_ratings r where r.supplier_id = s.id),
         (select count(*)::integer from public.supplier_ratings r where r.supplier_id = s.id),
         (select count(*)::integer from public.products p where p.supplier_id = s.id and p.status = 'live' and p.deleted_at is null)
    from public.profiles s
   where s.id = p_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
$$;

-- Listing cards: a supplier's live listings, or a category's (optionally excluding one), newest first.
drop function if exists public.public_listings(uuid, uuid, uuid, integer);
create function public.public_listings(p_supplier_id uuid default null, p_category_id uuid default null,
  p_exclude_id uuid default null, p_limit integer default 12)
returns table (id uuid, title text, origin_country text, landed_cost_cents integer, trial_units integer,
  image_url text, supplier_id uuid, supplier_company text, supplier_verified boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.origin_country::text, p.trial_landed_cost_cents, p.trial_units,
         (select m.public_url from public.product_media m
           where m.product_id = p.id and m.media_type = 'image' and m.public_url is not null order by m.sort_order, m.id limit 1),
         s.id, s.company_name, s.kyc_verified, p.created_at
    from public.products p
    join public.profiles s on s.id = p.supplier_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
   where p.status = 'live' and p.deleted_at is null
     and (p_supplier_id is not null or p_category_id is not null)          -- never "everything"
     and (p_supplier_id is null or p.supplier_id = p_supplier_id)
     and (p_category_id is null or p.category_id = p_category_id)
     and (p_exclude_id is null or p.id <> p_exclude_id)
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 12), 1), 48)
$$;

-- Sitemap: every public listing and every supplier with at least one, with last-modified times.
drop function if exists public.public_sitemap_entries(integer);
create function public.public_sitemap_entries(p_limit integer default 45000)
returns table (kind text, id uuid, last_modified timestamptz)
language sql stable security definer set search_path = public as $$
  (select 'product'::text, p.id, p.updated_at
     from public.products p
     join public.profiles s on s.id = p.supplier_id and s.role = 'supplier' and not coalesce(s.is_banned, false)
    where p.status = 'live' and p.deleted_at is null
    order by p.updated_at desc
    limit least(greatest(coalesce(p_limit, 45000), 1), 45000))
  union all
  (select 'supplier'::text, s.id, greatest(s.updated_at, max(p.updated_at))
     from public.profiles s
     join public.products p on p.supplier_id = s.id and p.status = 'live' and p.deleted_at is null
    where s.role = 'supplier' and not coalesce(s.is_banned, false)
    group by s.id, s.updated_at
    order by 3 desc
    limit least(greatest(coalesce(p_limit, 45000), 1), 45000))
$$;

do $$
declare f text;
begin
  foreach f in array array['public.public_listing(uuid)', 'public.public_supplier(uuid)',
    'public.public_listings(uuid, uuid, uuid, integer)', 'public.public_sitemap_entries(integer)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
