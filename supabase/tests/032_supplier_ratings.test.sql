-- Migration 032: supplier star ratings. Only buyers with a released order from that supplier may rate; 1–5 stars;
-- one rating per pair (changeable); own rows only; the public aggregate never names raters; anon denied.
-- Run with `npm run test:db` (scripts/db-test.mjs). Own users; independent of the other test files.
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
create or replace function pg_temp.n_ratings() returns integer language sql as $$ select count(*)::integer from public.supplier_ratings $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3211111-1111-4111-8111-111111111111', 's32@x.test', '{"role":"supplier","full_name":"Sup 32","company_name":"Sup 32 Co","country_code":"CN"}'),
 ('e3222222-2222-4222-8222-222222222222', 'b32@x.test', '{"role":"importer","full_name":"Buyer 32","company_name":"Buyer 32 Co","country_code":"KE"}'),
 ('e3233333-3333-4333-8333-333333333333', 'c32@x.test', '{"role":"importer","full_name":"Other 32","company_name":"Other 32 Co","country_code":"NG"}'),
 ('e3244444-4444-4444-8444-444444444444', 'd32@x.test', '{"role":"importer","full_name":"Third 32","company_name":"Third 32 Co","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e32%';
insert into public.categories (id, slug, name) values ('f3200000-0000-4000-8000-000000000001', 'ratings-32', 'Ratings 32');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f3200000-0000-4000-8000-0000000000a1', 'e3211111-1111-4111-8111-111111111111', 'general', 'f3200000-0000-4000-8000-000000000001', 'Rated 32', 'CN', 500, 100, 50000, 5000, 2000, 'live');
-- Buyer 32: a released order (may rate). Other 32: only an in-transit order (may not). Third 32: released (rates too).
insert into public.orders (buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents, escrow_status) values
 ('e3222222-2222-4222-8222-222222222222', 'f3200000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'released'),
 ('e3233333-3333-4333-8333-333333333333', 'f3200000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'in_transit'),
 ('e3244444-4444-4444-8444-444444444444', 'f3200000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'released');

set role authenticated;
select pg_temp.as_user('e3222222-2222-4222-8222-222222222222');
select pg_temp.ok(public.can_rate_supplier('e3211111-1111-4111-8111-111111111111'), 'buyer with a released order may rate');
select pg_temp.ok((select ratings = 0 and average is null from public.supplier_rating('e3211111-1111-4111-8111-111111111111')), 'unrated supplier: 0 ratings, no average');
insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3222222-2222-4222-8222-222222222222', 'e3211111-1111-4111-8111-111111111111', 4);
select pg_temp.ok(pg_temp.n_ratings() = 1, 'buyer rates and reads their own rating');
select pg_temp.fails($q$insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3222222-2222-4222-8222-222222222222', 'e3211111-1111-4111-8111-111111111111', 5)$q$, 'duplicate key');
update public.supplier_ratings set stars = 5 where supplier_id = 'e3211111-1111-4111-8111-111111111111';
select pg_temp.ok((select stars from public.supplier_ratings) = 5, 'buyer changes their rating');
select pg_temp.fails($q$update public.supplier_ratings set stars = 6$q$, 'supplier_ratings_stars_check|check constraint');
select pg_temp.fails($q$update public.supplier_ratings set supplier_id = 'e3233333-3333-4333-8333-333333333333'$q$, 'permission denied');
select pg_temp.fails($q$insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3233333-3333-4333-8333-333333333333', 'e3211111-1111-4111-8111-111111111111', 1)$q$, 'row-level security');

select pg_temp.as_user('e3233333-3333-4333-8333-333333333333');
select pg_temp.ok(not public.can_rate_supplier('e3211111-1111-4111-8111-111111111111'), 'an in-transit order is not enough to rate');
select pg_temp.fails($q$insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3233333-3333-4333-8333-333333333333', 'e3211111-1111-4111-8111-111111111111', 1)$q$, 'row-level security');
select pg_temp.ok(pg_temp.n_ratings() = 0, 'another buyer cannot read someone else''s rating');

select pg_temp.as_user('e3244444-4444-4444-8444-444444444444');
insert into public.supplier_ratings (buyer_id, supplier_id, stars, comment) values ('e3244444-4444-4444-8444-444444444444', 'e3211111-1111-4111-8111-111111111111', 2, 'Late shipment');
select pg_temp.ok((select ratings = 2 and average = 3.50 from public.supplier_rating('e3211111-1111-4111-8111-111111111111')), 'aggregate: 2 ratings, average 3.50 (5 and 2)');

select pg_temp.as_user('e3211111-1111-4111-8111-111111111111');
select pg_temp.ok(pg_temp.n_ratings() = 0, 'the supplier cannot list who rated them');
select pg_temp.ok((select ratings from public.supplier_rating('e3211111-1111-4111-8111-111111111111')) = 2, 'but sees the aggregate');
select pg_temp.fails($q$insert into public.supplier_ratings (buyer_id, supplier_id, stars) values ('e3211111-1111-4111-8111-111111111111', 'e3211111-1111-4111-8111-111111111111', 5)$q$, 'supplier_ratings_not_self|row-level security');

select pg_temp.as_user('e3222222-2222-4222-8222-222222222222');
delete from public.supplier_ratings where supplier_id = 'e3211111-1111-4111-8111-111111111111';
select pg_temp.ok((select ratings from public.supplier_rating('e3211111-1111-4111-8111-111111111111')) = 1, 'buyer removes their rating; only theirs goes');
reset role;

set role anon;
select pg_temp.fails($q$select * from public.supplier_rating('e3211111-1111-4111-8111-111111111111')$q$, 'permission denied');
select pg_temp.fails($q$select count(*) from public.supplier_ratings$q$, 'permission denied');
reset role;
select 'ALL 032 CHECKS PASSED' as result;
