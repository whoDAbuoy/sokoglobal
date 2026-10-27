-- Migration 035: followed_suppliers_overview() returns exactly what the
-- four per-supplier functions it replaces return (public_profile, supplier_rating, can_rate_supplier,
-- supplier_follower_count), with the same visibility rules. Run with `npm run test:db`.
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
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3611111-1111-4111-8111-111111111111', 's36a@x.test', '{"role":"supplier","full_name":"Sup A","company_name":"Sup A Co","country_code":"CN"}'),
 ('e3622222-2222-4222-8222-222222222222', 's36b@x.test', '{"role":"supplier","full_name":"Sup B","company_name":"Sup B Co","country_code":"IN"}'),
 ('e3633333-3333-4333-8333-333333333333', 'b36@x.test',  '{"role":"importer","full_name":"Buyer 36","company_name":"Buyer 36 Co","country_code":"KE"}'),
 ('e3644444-4444-4444-8444-444444444444', 'c36@x.test',  '{"role":"importer","full_name":"Other 36","company_name":"Other 36 Co","country_code":"NG"}'),
 ('e3655555-5555-4555-8555-555555555555', 'x36@x.test',  '{"role":"supplier","full_name":"Banned","company_name":"Banned 36 Co","country_code":"CN"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e36%';
update public.profiles set bio = 'We make electric kettles in Shenzhen' where id = 'e3611111-1111-4111-8111-111111111111';
update public.profiles set is_banned = true where id = 'e3655555-5555-4555-8555-555555555555';
insert into public.categories (id, slug, name) values ('f3600000-0000-4000-8000-000000000001', 'overview-36', 'Overview 36');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f3600000-0000-4000-8000-0000000000a1', 'e3611111-1111-4111-8111-111111111111', 'general', 'f3600000-0000-4000-8000-000000000001', 'Kettle 36', 'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f3600000-0000-4000-8000-0000000000a2', 'e3611111-1111-4111-8111-111111111111', 'general', 'f3600000-0000-4000-8000-000000000001', 'Draft 36', 'CN', 500, 100, 50000, 5000, 2000, 'draft');
insert into public.orders (buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents, escrow_status) values
 ('e3633333-3333-4333-8333-333333333333', 'f3600000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'released'),
 ('e3644444-4444-4444-8444-444444444444', 'f3600000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'released');
insert into public.follows (follower_id, following_id) values
 ('e3633333-3333-4333-8333-333333333333', 'e3611111-1111-4111-8111-111111111111'),
 ('e3633333-3333-4333-8333-333333333333', 'e3622222-2222-4222-8222-222222222222'),
 ('e3644444-4444-4444-8444-444444444444', 'e3611111-1111-4111-8111-111111111111');
insert into public.supplier_ratings (buyer_id, supplier_id, stars) values
 ('e3633333-3333-4333-8333-333333333333', 'e3611111-1111-4111-8111-111111111111', 5),
 ('e3644444-4444-4444-8444-444444444444', 'e3611111-1111-4111-8111-111111111111', 2);

set role authenticated;
select pg_temp.as_user('e3633333-3333-4333-8333-333333333333');
create temp table ov as select * from public.followed_suppliers_overview(array[
  'e3611111-1111-4111-8111-111111111111', 'e3622222-2222-4222-8222-222222222222', 'e3655555-5555-4555-8555-555555555555']::uuid[]);
select pg_temp.ok((select count(*) from ov) = 2, 'banned accounts are left out');

-- Same values as the per-supplier functions, for each supplier.
select pg_temp.ok((select o.bio = p.bio and o.follower_count = p.follower_count and o.following_count = p.following_count and o.live_listings = p.live_listings
                     from ov o, public.public_profile(o.id) p where o.id = 'e3611111-1111-4111-8111-111111111111'), 'matches public_profile() for supplier A');
select pg_temp.ok((select o.bio is null and o.follower_count = 1 and o.live_listings = 0 from ov o where o.id = 'e3622222-2222-4222-8222-222222222222'),
  'matches public_profile() for supplier B (no bio, no listings)');
select pg_temp.ok((select o.follower_count = public.supplier_follower_count(o.id) from ov o where o.id = 'e3611111-1111-4111-8111-111111111111'), 'matches supplier_follower_count()');
select pg_temp.ok((select o.rating_average = r.average and o.rating_count = r.ratings from ov o, public.supplier_rating(o.id) r where o.id = 'e3611111-1111-4111-8111-111111111111'),
  'matches supplier_rating() (3.50 from 2 ratings)');
select pg_temp.ok((select rating_average is null and rating_count = 0 from ov where id = 'e3622222-2222-4222-8222-222222222222'), 'unrated: no average, 0 ratings');
select pg_temp.ok((select can_rate = public.can_rate_supplier(id) and can_rate from ov where id = 'e3611111-1111-4111-8111-111111111111'), 'matches can_rate_supplier() (released order)');
select pg_temp.ok((select not can_rate from ov where id = 'e3622222-2222-4222-8222-222222222222'), 'no order from supplier B: cannot rate');

-- Limits and access.
select pg_temp.ok((select count(*) from public.followed_suppliers_overview(array(select gen_random_uuid() from generate_series(1, 201)))) = 0,
  'more than 200 ids returns nothing');
reset role;
set role anon;
select pg_temp.fails($q$select * from public.followed_suppliers_overview(array['e3611111-1111-4111-8111-111111111111']::uuid[])$q$, 'permission denied');
reset role;

select 'ALL 035 CHECKS PASSED' as result;
