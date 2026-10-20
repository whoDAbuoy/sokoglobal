-- =============================================================================
-- SokoGlobal — Migration 015: open multi-commodity catalogue. Run after 014.
-- Re-runnable.
--
--  * categories: an admin-managed parent → child tree (Agriculture → Spices →
--    Vanilla Beans). Each node carries an attribute_schema (the fields a
--    supplier fills in and buyers filter on); children inherit their
--    ancestors' fields.
--  * products gain category_id, sku, moq, unit_of_measure, price_tiers and a
--    "featured" flag. The legacy products.category enum stays and is kept in
--    sync from the chosen category (beauty / clothing / general), so every
--    existing query, policy and function (e.g. the beauty swatch-video rule)
--    keeps working unchanged. Existing products are backfilled.
--  * super_set_product_state(): audited catalogue status override for super
--    admins (draft / under review / published / delisted / featured).
-- =============================================================================

-- New legacy bucket for everything that is neither beauty nor clothing.
-- (Only ever referenced as text / at run time below, so this file can run in
-- one transaction.)
alter type public.product_category add value if not exists 'general';

-- ── 1. Category tree ────────────────────────────────────────────────────────
create table if not exists public.categories (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid references public.categories (id) on delete restrict,
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name                text not null check (char_length(name) between 2 and 80),
  description         text check (description is null or char_length(description) <= 500),
  icon                text check (icon is null or char_length(icon) <= 40),
  sort_order          integer not null default 0,
  is_active           boolean not null default true,
  -- [{ key, label, type: text|number|select|multiselect|list|boolean, unit?, options?, required?, facet? }]
  attribute_schema    jsonb not null default '[]'::jsonb check (jsonb_typeof(attribute_schema) = 'array' and pg_column_size(attribute_schema) <= 16384),
  legacy_category     text not null default 'general' check (legacy_category in ('beauty', 'clothing', 'general')),
  requires_compliance boolean not null default false,   -- permits / SDS / assay reviewed before publishing
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint category_not_own_parent check (parent_id is null or parent_id <> id)
);
create index if not exists categories_parent_idx on public.categories (parent_id, sort_order);

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();

-- No cycles, at most 4 levels deep.
create or replace function public.categories_check_tree()
returns trigger language plpgsql as $$
declare v_parent uuid := new.parent_id; v_depth integer := 1;
begin
  while v_parent is not null loop
    if v_parent = new.id then raise exception 'A category cannot be placed inside itself'; end if;
    v_depth := v_depth + 1;
    if v_depth > 4 then raise exception 'Categories can be at most 4 levels deep'; end if;
    select parent_id into v_parent from public.categories where id = v_parent;
  end loop;
  return new;
end $$;
drop trigger if exists categories_tree_guard on public.categories;
create trigger categories_tree_guard before insert or update of parent_id on public.categories
  for each row execute function public.categories_check_tree();

alter table public.categories enable row level security;
drop policy if exists "categories: everyone reads" on public.categories;
drop policy if exists "categories: admin writes" on public.categories;
create policy "categories: everyone reads" on public.categories for select using (true);
create policy "categories: admin writes" on public.categories for all to authenticated
  using ((select public.current_role_is('admin'))) with check ((select public.current_role_is('admin')));
revoke insert, update, delete, truncate on public.categories from anon;
grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;

-- Every category change lands in the immutable audit trail.
create or replace function public.audit_category_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- migrations / seeds
  perform public.write_admin_audit('category.' || lower(tg_op), 'category', coalesce(new.id, old.id)::text,
    jsonb_build_object('slug', coalesce(new.slug, old.slug), 'name', coalesce(new.name, old.name),
                       'is_active', coalesce(new.is_active, old.is_active)), null, null);
  return coalesce(new, old);
end $$;
drop trigger if exists categories_audit on public.categories;
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_category_change();

-- ── 2. Seed tree (upsert by slug; admins can edit everything afterwards) ────
create or replace function public.seed_category(p_slug text, p_parent text, p_name text, p_icon text, p_sort integer,
  p_legacy text, p_compliance boolean, p_schema jsonb, p_description text default null)
returns void language plpgsql as $$
begin
  insert into public.categories (slug, parent_id, name, icon, sort_order, legacy_category, requires_compliance, attribute_schema, description)
  values (p_slug, (select id from public.categories where slug = p_parent), p_name, p_icon, p_sort, p_legacy, p_compliance, p_schema, p_description)
  on conflict (slug) do nothing;   -- never overwrite an admin's edits on re-run
end $$;

do $$
declare
  cert_food   jsonb := '{"key":"certifications","label":"Certifications","type":"multiselect","facet":true,"options":["Organic","Fairtrade","Rainforest Alliance","GlobalG.A.P.","Halal","Kosher","HACCP","ISO 22000"]}';
  grade       jsonb := '{"key":"grade","label":"Purity / quality grade","type":"select","facet":true,"options":["Premium / Grade A","Grade B","Grade C","Industrial / processing"]}';
  harvest     jsonb := '{"key":"harvest_year","label":"Harvest year","type":"number","facet":true}';
  moisture    jsonb := '{"key":"moisture_pct","label":"Moisture","type":"number","unit":"%"}';
  purity      jsonb := '{"key":"purity_pct","label":"Purity","type":"number","unit":"%","facet":true}';
  shelf_m     jsonb := '{"key":"shelf_life_months","label":"Shelf life","type":"number","unit":"months"}';
  material    jsonb := '{"key":"material","label":"Material","type":"text","facet":true}';
  condition   jsonb := '{"key":"condition","label":"Condition","type":"select","required":true,"facet":true,"options":["New","Refurbished","Used"]}';
  cert_elec   jsonb := '{"key":"certifications","label":"Certifications","type":"multiselect","facet":true,"options":["CE","FCC","RoHS","UL","IEC","KEBS","SONCAP"]}';
begin
  -- Agriculture
  perform public.seed_category('agriculture', null, 'Agriculture & Produce', 'sprout', 10, 'general', false,
    jsonb_build_array(grade, harvest, moisture, cert_food), 'Raw and lightly processed farm commodities.');
  perform public.seed_category('spices-herbs', 'agriculture', 'Spices & Herbs', 'leaf', 10, 'general', false,
    '[{"key":"form","label":"Form","type":"select","facet":true,"options":["Whole","Cut / sifted","Ground","Oil / extract"]}]');
  perform public.seed_category('vanilla-beans', 'spices-herbs', 'Vanilla Beans', 'leaf', 10, 'general', false,
    '[{"key":"bean_length_cm","label":"Bean length","type":"number","unit":"cm","facet":true},{"key":"vanillin_pct","label":"Vanillin content","type":"number","unit":"%"},{"key":"variety","label":"Variety","type":"select","facet":true,"options":["Planifolia (Bourbon)","Tahitensis","Pompona"]}]');
  perform public.seed_category('pepper-cloves', 'spices-herbs', 'Pepper, Cloves & Cardamom', 'leaf', 20, 'general', false, '[]');
  perform public.seed_category('coffee-tea', 'agriculture', 'Coffee, Tea & Cocoa', 'coffee', 20, 'general', false,
    '[{"key":"variety","label":"Variety / cultivar","type":"text","facet":true},{"key":"process","label":"Process","type":"select","facet":true,"options":["Washed","Natural","Honey","CTC","Orthodox","Fermented"]},{"key":"cupping_score","label":"Cupping score","type":"number"}]');
  perform public.seed_category('grains-pulses', 'agriculture', 'Grains & Pulses', 'wheat', 30, 'general', false, jsonb_build_array(purity));
  perform public.seed_category('nuts-seeds', 'agriculture', 'Nuts, Seeds & Oilseeds', 'nut', 40, 'general', false,
    '[{"key":"kernel_grade","label":"Kernel grade / count","type":"text"}]');
  perform public.seed_category('fresh-produce', 'agriculture', 'Fresh Fruit & Vegetables', 'apple', 50, 'general', false,
    '[{"key":"cold_chain","label":"Cold chain required","type":"boolean","facet":true},{"key":"shelf_life_days","label":"Shelf life","type":"number","unit":"days"}]');

  -- Food & beverage
  perform public.seed_category('food-beverage', null, 'Food & Beverage', 'utensils', 20, 'general', false,
    jsonb_build_array(shelf_m, '{"key":"storage","label":"Storage","type":"select","facet":true,"options":["Ambient","Chilled","Frozen"]}'::jsonb, cert_food));
  perform public.seed_category('packaged-foods', 'food-beverage', 'Packaged & Processed Foods', 'package', 10, 'general', false, '[]');
  perform public.seed_category('beverages', 'food-beverage', 'Beverages', 'cup-soda', 20, 'general', false, '[]');
  perform public.seed_category('edible-oils', 'food-beverage', 'Edible Oils & Fats', 'droplet', 30, 'general', false, jsonb_build_array(purity));

  -- Beauty (legacy 'beauty': swatch video rule still applies)
  perform public.seed_category('beauty-personal-care', null, 'Beauty & Personal Care', 'sparkles', 30, 'beauty', false,
    jsonb_build_array('{"key":"shade_range","label":"Shades","type":"list"}'::jsonb,
      '{"key":"skin_types","label":"Skin / hair types","type":"multiselect","facet":true,"options":["All","Dry","Oily","Combination","Sensitive","Curly / coily"]}'::jsonb,
      shelf_m, '{"key":"certifications","label":"Certifications","type":"multiselect","facet":true,"options":["Cruelty-free","Vegan","Halal","COSMOS Organic","Dermatologist tested"]}'::jsonb),
    'Skincare, haircare and cosmetics. Listings need a swatch video.');
  perform public.seed_category('skincare', 'beauty-personal-care', 'Skincare', 'sparkles', 10, 'beauty', false, '[]');
  perform public.seed_category('haircare', 'beauty-personal-care', 'Haircare', 'sparkles', 20, 'beauty', false, '[]');
  perform public.seed_category('cosmetics', 'beauty-personal-care', 'Cosmetics & Makeup', 'sparkles', 30, 'beauty', false, '[]');
  perform public.seed_category('fragrance', 'beauty-personal-care', 'Fragrance', 'sparkles', 40, 'beauty', false, '[]');

  -- Apparel & textiles (legacy 'clothing')
  perform public.seed_category('apparel-textiles', null, 'Apparel & Textiles', 'shirt', 40, 'clothing', false,
    jsonb_build_array('{"key":"sizes","label":"Sizes","type":"list"}'::jsonb, '{"key":"materials","label":"Materials / composition","type":"text","facet":true}'::jsonb,
      '{"key":"gsm","label":"Fabric weight","type":"number","unit":"g/m²"}'::jsonb));
  perform public.seed_category('clothing', 'apparel-textiles', 'Clothing', 'shirt', 10, 'clothing', false,
    '[{"key":"fit","label":"Fit","type":"select","facet":true,"options":["Regular","Slim","Relaxed","Oversized"]}]');
  perform public.seed_category('fabrics-yarn', 'apparel-textiles', 'Fabrics & Yarn', 'scroll', 20, 'clothing', false, '[]');
  perform public.seed_category('footwear', 'apparel-textiles', 'Footwear & Leather', 'footprints', 30, 'clothing', false, '[]');
  perform public.seed_category('home-textiles', 'apparel-textiles', 'Home Textiles', 'bed', 40, 'clothing', false, '[]');

  -- Electronics
  perform public.seed_category('electronics', null, 'Electronics & Electrical', 'cpu', 50, 'general', false,
    jsonb_build_array('{"key":"model_number","label":"Model number","type":"text"}'::jsonb,
      '{"key":"voltage","label":"Voltage","type":"select","facet":true,"options":["110–120 V","220–240 V","Dual voltage","12 / 24 V DC","Battery"]}'::jsonb,
      '{"key":"warranty_months","label":"Warranty","type":"number","unit":"months"}'::jsonb, cert_elec, condition));
  perform public.seed_category('consumer-electronics', 'electronics', 'Consumer Electronics', 'smartphone', 10, 'general', false, '[]');
  perform public.seed_category('solar-energy', 'electronics', 'Solar & Energy Storage', 'sun', 20, 'general', false,
    '[{"key":"rated_power_w","label":"Rated power","type":"number","unit":"W","facet":true}]');
  perform public.seed_category('electronic-components', 'electronics', 'Components & Cables', 'circuit-board', 30, 'general', false, '[]');

  -- Machinery
  perform public.seed_category('machinery', null, 'Machinery & Heavy Equipment', 'tractor', 60, 'general', true,
    jsonb_build_array(condition, '{"key":"year_of_manufacture","label":"Year of manufacture","type":"number","facet":true}'::jsonb,
      '{"key":"power_kw","label":"Power","type":"number","unit":"kW"}'::jsonb, '{"key":"weight_kg","label":"Shipping weight","type":"number","unit":"kg"}'::jsonb),
    'Shipped as break-bulk or flat-rack; inspection certificates are reviewed before publishing.');
  perform public.seed_category('agricultural-machinery', 'machinery', 'Agricultural Machinery', 'tractor', 10, 'general', true, '[]');
  perform public.seed_category('construction-equipment', 'machinery', 'Construction Equipment', 'construction', 20, 'general', true, '[]');
  perform public.seed_category('processing-equipment', 'machinery', 'Processing & Packaging Lines', 'factory', 30, 'general', true, '[]');

  -- Industrial
  perform public.seed_category('industrial-supplies', null, 'Industrial Parts & Supplies', 'wrench', 70, 'general', false,
    jsonb_build_array(material, '{"key":"standard","label":"Standard (ISO / ASTM / DIN)","type":"text"}'::jsonb));
  perform public.seed_category('fasteners-hardware', 'industrial-supplies', 'Fasteners & Hardware', 'wrench', 10, 'general', false, '[]');
  perform public.seed_category('tools', 'industrial-supplies', 'Tools', 'hammer', 20, 'general', false, '[]');
  perform public.seed_category('packaging-materials', 'industrial-supplies', 'Packaging Materials', 'package', 30, 'general', false, '[]');
  perform public.seed_category('auto-parts', 'industrial-supplies', 'Automotive & Transport Parts', 'car', 40, 'general', false,
    '[{"key":"vehicle_compatibility","label":"Vehicle compatibility","type":"text","facet":true},{"key":"oem_number","label":"OEM part number","type":"text"}]');

  -- Chemicals
  perform public.seed_category('chemicals', null, 'Chemicals & Plastics', 'flask-conical', 80, 'general', true,
    jsonb_build_array('{"key":"cas_number","label":"CAS number","type":"text"}'::jsonb, purity,
      '{"key":"hazard_class","label":"Hazard class","type":"select","required":true,"facet":true,"options":["Non-hazardous","Class 3 — flammable liquid","Class 5 — oxidiser","Class 8 — corrosive","Other (see SDS)"]}'::jsonb,
      '{"key":"sds_available","label":"Safety data sheet available","type":"boolean","required":true}'::jsonb),
    'Hazardous goods ship under IMDG rules; an SDS is required.');
  perform public.seed_category('industrial-chemicals', 'chemicals', 'Industrial Chemicals', 'flask-conical', 10, 'general', true, '[]');
  perform public.seed_category('plastics-polymers', 'chemicals', 'Plastics & Polymers', 'flask-conical', 20, 'general', true, '[]');
  perform public.seed_category('fertilizers', 'chemicals', 'Fertilisers & Agro-inputs', 'sprout', 30, 'general', true, '[]');

  -- Minerals & metals
  perform public.seed_category('minerals-metals', null, 'Minerals & Metals', 'gem', 90, 'general', true,
    jsonb_build_array(purity, '{"key":"form","label":"Form","type":"select","facet":true,"options":["Ore","Concentrate","Ingot / cathode","Sheet / coil","Bar / rod","Scrap"]}'::jsonb,
      '{"key":"assay_certificate","label":"Assay certificate available","type":"boolean","facet":true}'::jsonb),
    'Origin and assay documents are verified before publishing.');
  perform public.seed_category('base-metals', 'minerals-metals', 'Base Metals', 'gem', 10, 'general', true, '[]');
  perform public.seed_category('industrial-minerals', 'minerals-metals', 'Industrial Minerals', 'mountain', 20, 'general', true, '[]');
  perform public.seed_category('scrap-recyclables', 'minerals-metals', 'Scrap & Recyclables', 'recycle', 30, 'general', true, '[]');

  -- Home & crafts
  perform public.seed_category('home-furniture', null, 'Home, Furniture & Crafts', 'armchair', 100, 'general', false,
    jsonb_build_array(material, '{"key":"dimensions_cm","label":"Dimensions (L×W×H)","type":"text","unit":"cm"}'::jsonb));
  perform public.seed_category('furniture', 'home-furniture', 'Furniture', 'armchair', 10, 'general', false, '[]');
  perform public.seed_category('handicrafts', 'home-furniture', 'Handicrafts & Décor', 'palette', 20, 'general', false, '[]');

  -- Health
  perform public.seed_category('health-medical', null, 'Health & Medical Supplies', 'heart-pulse', 110, 'general', true,
    '[{"key":"regulatory_approval","label":"Regulatory approval (e.g. FDA, CE, PPB)","type":"text","required":true},{"key":"sterile","label":"Sterile","type":"boolean","facet":true}]',
    'Registration with the destination regulator is checked before publishing.');
end $$;

-- ── 3. Product columns ──────────────────────────────────────────────────────
alter table public.products add column if not exists category_id     uuid references public.categories (id) on delete restrict;
alter table public.products add column if not exists sku             text check (sku is null or (char_length(sku) between 1 and 64 and sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'));
alter table public.products add column if not exists moq             integer check (moq is null or moq between 1 and 100000000);
alter table public.products add column if not exists unit_of_measure text check (unit_of_measure is null or char_length(unit_of_measure) between 1 and 24);
alter table public.products add column if not exists price_tiers     jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists is_featured     boolean not null default false;
alter table public.products add column if not exists featured_at     timestamptz;
alter table public.products add column if not exists search_tsv      tsvector generated always as (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(sku, '') || ' ' || coalesce(description, ''))) stored;

-- Shape checks. NOT VALID: enforced for every new/edited row without failing on historical data.
alter table public.products drop constraint if exists products_attributes_shape;
alter table public.products add constraint products_attributes_shape
  check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 16384) not valid;
alter table public.products drop constraint if exists products_price_tiers_shape;
alter table public.products add constraint products_price_tiers_shape
  check (jsonb_typeof(price_tiers) = 'array' and jsonb_array_length(price_tiers) <= 10) not valid;

create unique index if not exists products_supplier_sku_uniq on public.products (supplier_id, lower(sku)) where sku is not null and deleted_at is null;
create index if not exists products_category_live_idx on public.products (category_id, created_at desc) where status = 'live';
create index if not exists products_featured_idx on public.products (featured_at desc) where is_featured and status = 'live';
create index if not exists products_attributes_gin on public.products using gin (attributes jsonb_path_ops);
create index if not exists products_search_gin on public.products using gin (search_tsv);

-- Backfill existing listings into the matching seeded node.
update public.products p set category_id = c.id
  from public.categories c
 where p.category_id is null
   and c.slug = case p.category::text when 'beauty' then 'beauty-personal-care' when 'clothing' then 'clothing' end;

-- Keep products.category (legacy enum) in sync, validate tiers, drop "featured" when a listing leaves live.
create or replace function public.products_catalog_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat public.categories; v_tier jsonb; v_prev integer := 0; v_prev_price integer := null;
begin
  if new.category_id is null then
    if tg_op = 'INSERT' and new.category::text in ('beauty', 'clothing') then   -- older clients that only send the enum
      select * into v_cat from public.categories
       where slug = case new.category::text when 'beauty' then 'beauty-personal-care' else 'clothing' end;
      new.category_id := v_cat.id;
    elsif tg_op = 'INSERT' then
      raise exception 'Choose a category for this listing';
    end if;
  elsif tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    select * into v_cat from public.categories where id = new.category_id;
    if not found then raise exception 'Unknown category'; end if;
    if not v_cat.is_active then raise exception 'The category "%" is not accepting new listings', v_cat.name; end if;
    new.category := v_cat.legacy_category::public.product_category;
  end if;

  if tg_op = 'INSERT' or new.price_tiers is distinct from old.price_tiers then
    if jsonb_typeof(new.price_tiers) <> 'array' then raise exception 'Price tiers must be a list'; end if;
    if jsonb_array_length(new.price_tiers) > 10 then raise exception 'Use at most 10 price tiers'; end if;
    for v_tier in select value from jsonb_array_elements(new.price_tiers) loop
      if jsonb_typeof(v_tier -> 'min_qty') <> 'number' or jsonb_typeof(v_tier -> 'unit_price_cents') <> 'number'
         or (v_tier ->> 'min_qty')::numeric <> trunc((v_tier ->> 'min_qty')::numeric)
         or (v_tier ->> 'unit_price_cents')::numeric <> trunc((v_tier ->> 'unit_price_cents')::numeric)
         or (v_tier ->> 'min_qty')::numeric < 1 or (v_tier ->> 'unit_price_cents')::numeric < 1 then
        raise exception 'Each price tier needs a whole minimum quantity and a unit price';
      end if;
      if (v_tier ->> 'min_qty')::integer <= v_prev then raise exception 'Price tiers must have increasing minimum quantities'; end if;
      if v_prev_price is not null and (v_tier ->> 'unit_price_cents')::integer > v_prev_price then
        raise exception 'Larger price tiers cannot cost more per unit';
      end if;
      v_prev := (v_tier ->> 'min_qty')::integer; v_prev_price := (v_tier ->> 'unit_price_cents')::integer;
    end loop;
  end if;

  if new.status <> 'live' and new.is_featured then new.is_featured := false; new.featured_at := null; end if;
  return new;
end $$;
drop trigger if exists products_catalog_sync on public.products;
create trigger products_catalog_sync before insert or update on public.products
  for each row execute function public.products_catalog_sync();

-- Suppliers may set the new descriptive fields (never is_featured / status / quotes).
grant insert (supplier_id, category, category_id, title, brand, description, origin_country, attributes,
              unit_price_cents, lead_time_days, trial_units, trial_goods_cents, sku, moq, unit_of_measure, price_tiers)
  on public.products to authenticated;
grant update (title, brand, description, attributes, unit_price_cents, lead_time_days,
              trial_units, trial_goods_cents, category_id, sku, moq, unit_of_measure, price_tiers)
  on public.products to authenticated;

-- ── 4. Catalogue status override (super admins, audited) ────────────────────
create or replace function public.super_set_product_state(p_product_id uuid, p_state text, p_reason text,
  p_ip text default null, p_ua text default null)
returns public.products language plpgsql security definer set search_path = public as $$
declare v public.products; v_old public.products; v_reason text := public.require_super_reason(p_reason);
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v_old from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if v_old.deleted_at is not null then raise exception 'This listing was removed; it cannot be changed here'; end if;

  case p_state
    when 'draft' then
      update public.products set status = 'draft', review_notes = left(v_reason, 2000), reviewed_by = auth.uid(), reviewed_at = now()
       where id = p_product_id returning * into v;
    when 'under_review' then
      update public.products set status = 'pending_review' where id = p_product_id returning * into v;
    when 'published' then
      if v_old.reviewed_at is null and v_old.trial_freight_cents + v_old.trial_customs_cents = 0 then
        raise exception 'Quote freight and customs through Review before publishing this listing';
      end if;
      if v_old.trial_landed_cost_cents < public.trial_batch_min_cents() then
        raise exception 'Guaranteed Landed Cost is below the trial minimum';
      end if;
      update public.products set status = 'live', reviewed_by = auth.uid(), reviewed_at = coalesce(reviewed_at, now())
       where id = p_product_id returning * into v;
    when 'delisted' then   -- hidden from the catalogue; orders already placed carry on
      update public.products set status = 'archived' where id = p_product_id returning * into v;
    when 'featured' then
      if v_old.status <> 'live' then raise exception 'Only published listings can be featured'; end if;
      update public.products set is_featured = true, featured_at = now() where id = p_product_id returning * into v;
    when 'unfeatured' then
      update public.products set is_featured = false, featured_at = null where id = p_product_id returning * into v;
    else
      raise exception 'Unknown state %', p_state;
  end case;

  perform public.write_admin_audit('product.' || p_state, 'product', p_product_id::text,
    jsonb_build_object('from', v_old.status, 'to', v.status, 'featured', v.is_featured, 'reason', v_reason), p_ip, p_ua);
  return v;
end $$;
revoke all on function public.super_set_product_state(uuid, text, text, text, text) from public, anon;
grant execute on function public.super_set_product_state(uuid, text, text, text, text) to authenticated;

revoke all on function public.seed_category(text, text, text, text, integer, text, boolean, jsonb, text) from public, anon, authenticated;
