-- Migration 036: public catalogue functions. Signed-out visitors see live listings of suppliers in good
-- standing (never drafts, removed listings or banned suppliers), only the public columns, and still can't
-- read the tables directly. Run with `npm run test:db`. Own users; independent of the other test files.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; raise notice 'pass: %', msg; end $$;
create or replace function pg_temp.fails(q text, pattern text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ~* pattern then raise notice 'pass (raises /%/): %', pattern, left(q, 60); return; end if;
    raise exception 'ASSERT FAILED: % raised "%", expected /%/', q, sqlerrm, pattern;
  end;
  raise exception 'ASSERT FAILED: % did not raise (expected /%/)', q, pattern;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3711111-1111-4111-8111-111111111111', 'pub-s@x.test', '{"role":"supplier","full_name":"Private Person","company_name":"Kettle Works Ltd","country_code":"CN"}'),
 ('e3722222-2222-4222-8222-222222222222', 'pub-x@x.test', '{"role":"supplier","full_name":"Banned Person","company_name":"Banned Works","country_code":"CN"}'),
 ('e3733333-3333-4333-8333-333333333333', 'pub-b@x.test', '{"role":"importer","full_name":"Buyer Person","company_name":"Buyer Co","country_code":"KE"}');
update public.profiles set kyc_verified = true, phone_number = '+8613800000037' where id = 'e3711111-1111-4111-8111-111111111111';
update public.profiles set is_banned = true where id = 'e3722222-2222-4222-8222-222222222222';
insert into public.categories (id, slug, name) values ('f3700000-0000-4000-8000-000000000001', 'public-37', 'Kitchen 37');
insert into public.products (id, supplier_id, category, category_id, title, description, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status, sku, review_notes, freight_markup_percent, deleted_at) values
 ('f3700000-0000-4000-8000-0000000000a1', 'e3711111-1111-4111-8111-111111111111', 'general', 'f3700000-0000-4000-8000-000000000001', 'Steel kettle 37', 'A 1.7 L steel kettle.', 'CN', 500, 100, 50000, 5000, 2000, 'live', 'SKU-SECRET', 'internal note', 12.5, null),
 ('f3700000-0000-4000-8000-0000000000a2', 'e3711111-1111-4111-8111-111111111111', 'general', 'f3700000-0000-4000-8000-000000000001', 'Glass kettle 37', null, 'CN', 500, 100, 50000, 5000, 2000, 'live', null, null, null, null),
 ('f3700000-0000-4000-8000-0000000000a3', 'e3711111-1111-4111-8111-111111111111', 'general', 'f3700000-0000-4000-8000-000000000001', 'Draft kettle 37', null, 'CN', 500, 100, 50000, 5000, 2000, 'draft', null, null, null, null),
 ('f3700000-0000-4000-8000-0000000000a4', 'e3711111-1111-4111-8111-111111111111', 'general', 'f3700000-0000-4000-8000-000000000001', 'Removed kettle 37', null, 'CN', 500, 100, 50000, 5000, 2000, 'archived', null, null, null, now()),
 ('f3700000-0000-4000-8000-0000000000a5', 'e3722222-2222-4222-8222-222222222222', 'general', 'f3700000-0000-4000-8000-000000000001', 'Banned kettle 37', null, 'CN', 500, 100, 50000, 5000, 2000, 'live', null, null, null, null);
insert into public.product_media (product_id, supplier_id, media_type, public_url, storage_path, mime_type, bytes, sort_order) values
 ('f3700000-0000-4000-8000-0000000000a1', 'e3711111-1111-4111-8111-111111111111', 'image', 'https://cdn.test/k2.jpg', 'e37/k2.jpg', 'image/jpeg', 1000, 2),
 ('f3700000-0000-4000-8000-0000000000a1', 'e3711111-1111-4111-8111-111111111111', 'image', 'https://cdn.test/k1.jpg', 'e37/k1.jpg', 'image/jpeg', 1000, 1);
insert into public.orders (buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents, escrow_status) values
 ('e3733333-3333-4333-8333-333333333333', 'f3700000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'released');
insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3733333-3333-4333-8333-333333333333', 'e3711111-1111-4111-8111-111111111111', 4);

set role anon;
-- Listing page.
select pg_temp.ok((select title = 'Steel kettle 37' and landed_cost_cents = 57000 and supplier_company = 'Kettle Works Ltd' and supplier_verified
                          and category_name = 'Kitchen 37' and images = array['https://cdn.test/k1.jpg', 'https://cdn.test/k2.jpg']
                          and rating_average = 4.00 and rating_count = 1
                     from public.public_listing('f3700000-0000-4000-8000-0000000000a1')), 'anon reads a live listing with photos in order, supplier and rating');
select pg_temp.ok((select count(*) from public.public_listing('f3700000-0000-4000-8000-0000000000a3')) = 0, 'drafts are not public');
select pg_temp.ok((select count(*) from public.public_listing('f3700000-0000-4000-8000-0000000000a4')) = 0, 'removed listings are not public');
select pg_temp.ok((select count(*) from public.public_listing('f3700000-0000-4000-8000-0000000000a5')) = 0, 'a banned supplier''s listings are not public');
select pg_temp.ok((select row_to_json(l)::text !~* 'SKU-SECRET|internal note|12\.5|Private Person|8613800000037|pub-s@'
                     from public.public_listing('f3700000-0000-4000-8000-0000000000a1') l), 'no SKU, review notes, freight markup, personal name, phone or email');
-- Supplier page.
select pg_temp.ok((select company_name = 'Kettle Works Ltd' and kyc_verified and live_listings = 2 and rating_count = 1
                     from public.public_supplier('e3711111-1111-4111-8111-111111111111')), 'anon reads a supplier profile (2 live listings)');
select pg_temp.ok((select row_to_json(s)::text !~* 'Private Person|8613800000037|pub-s@' from public.public_supplier('e3711111-1111-4111-8111-111111111111') s),
  'supplier profile has no personal name, phone or email');
select pg_temp.ok((select count(*) from public.public_supplier('e3722222-2222-4222-8222-222222222222')) = 0, 'banned suppliers have no public profile');
select pg_temp.ok((select count(*) from public.public_supplier('e3733333-3333-4333-8333-333333333333')) = 0, 'buyers have no public profile');
-- Cards.
select pg_temp.ok((select array_agg(title order by title) from public.public_listings(p_supplier_id => 'e3711111-1111-4111-8111-111111111111'))
                  = array['Glass kettle 37', 'Steel kettle 37'], 'supplier cards: live listings only');
select pg_temp.ok((select array_agg(title) from public.public_listings(p_category_id => 'f3700000-0000-4000-8000-000000000001', p_exclude_id => 'f3700000-0000-4000-8000-0000000000a1'))
                  = array['Glass kettle 37'], 'related cards: same category, current listing and banned supplier excluded');
select pg_temp.ok((select image_url from public.public_listings(p_supplier_id => 'e3711111-1111-4111-8111-111111111111') where title = 'Steel kettle 37') = 'https://cdn.test/k1.jpg',
  'cards use the first photo');
select pg_temp.ok((select count(*) from public.public_listings()) = 0, 'no filter returns nothing (no whole-catalogue dump)');
select pg_temp.ok((select count(*) from public.public_listings(p_supplier_id => 'e3711111-1111-4111-8111-111111111111', p_limit => 1000)) <= 48, 'page size is capped');
-- Sitemap.
select pg_temp.ok((select count(*) from public.public_sitemap_entries() where kind = 'product' and id::text like 'f37%') = 2, 'sitemap: the two public listings');
select pg_temp.ok((select count(*) from public.public_sitemap_entries() where kind = 'supplier' and id::text like 'e37%') = 1, 'sitemap: suppliers with a public listing, banned left out');
-- Tables stay closed: RLS gives anon no rows (only the functions above expose anything).
select pg_temp.ok((select count(*) from public.products) = 0, 'anon reads no product rows directly');
select pg_temp.ok((select count(*) from public.profiles) = 0, 'anon reads no profile rows directly');
reset role;

select 'ALL 036 CHECKS PASSED' as result;
