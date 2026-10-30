-- Migration 039: card and M-Pesa on/off switches (settings validation and audit, enforcement on new attempts).
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
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e4311111-1111-4111-8111-111111111111', 's43@x.test',  '{"role":"supplier","full_name":"Sup 43","company_name":"Sup 43 Co","country_code":"CN"}'),
 ('e4322222-2222-4222-8222-222222222222', 'b43@x.test',  '{"role":"importer","full_name":"Buyer 43","company_name":"Buyer 43 Co","country_code":"KE"}'),
 ('e4333333-3333-4333-8333-333333333333', 'c43@x.test',  '{"role":"importer","full_name":"Other 43","company_name":"Other 43 Co","country_code":"UG"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e43%';
insert into public.categories (id, slug, name) values ('f4300000-0000-4000-8000-000000000001', 'trend-43', 'Trend 43');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f4300000-0000-4000-8000-0000000000aa', 'e4311111-1111-4111-8111-111111111111', 'general', 'f4300000-0000-4000-8000-000000000001', 'Hot 43',  'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f4300000-0000-4000-8000-0000000000bb', 'e4311111-1111-4111-8111-111111111111', 'general', 'f4300000-0000-4000-8000-000000000001', 'Warm 43', 'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f4300000-0000-4000-8000-0000000000cc', 'e4311111-1111-4111-8111-111111111111', 'general', 'f4300000-0000-4000-8000-000000000001', 'Draft 43', 'CN', 500, 100, 50000, 5000, 2000, 'draft');

-- ── Tracking ──
select pg_temp.as_user('');
select pg_temp.ok(not public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'view'), 'signed-out visitors are not tracked');
select pg_temp.as_user('e4322222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'click')$q$, 'Unknown interaction');
select pg_temp.ok(public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'view'), 'a buyer view is recorded');
select pg_temp.ok(public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'view'), 'a repeat view the same day is accepted');
select pg_temp.ok((select count(*) = 1 from public.product_interactions where user_id = 'e4322222-2222-4222-8222-222222222222' and kind = 'view'), '…but stored once per day');
select pg_temp.ok(public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'save'), 'a save is recorded');
select pg_temp.ok(not public.track_product_interaction('f4300000-0000-4000-8000-0000000000cc', 'view'), 'drafts are not tracked');
select pg_temp.as_user('e4311111-1111-4111-8111-111111111111');
select pg_temp.ok(not public.track_product_interaction('f4300000-0000-4000-8000-0000000000aa', 'view'), 'a supplier viewing their own listing is not tracked');
select pg_temp.as_user('e4322222-2222-4222-8222-222222222222');
set role authenticated;
select pg_temp.fails($q$select * from public.product_interactions$q$, 'permission denied');
reset role;

-- ── Ranking ──
select pg_temp.as_user('e4333333-3333-4333-8333-333333333333');
select pg_temp.ok(public.track_product_interaction('f4300000-0000-4000-8000-0000000000bb', 'view'), 'another buyer views the other listing');
select pg_temp.as_user('e4322222-2222-4222-8222-222222222222');
select (public.create_trial_order('f4300000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select pg_temp.as_user('');   -- funding happens server-side only (guard_order_funding)
update public.orders set escrow_status = 'funded' where id = :'o1';
select pg_temp.as_user('e4322222-2222-4222-8222-222222222222');
select pg_temp.ok((select product_id = 'f4300000-0000-4000-8000-0000000000aa' and orders = 1 and saves = 1 and views = 1 and buyers = 1
                     from public.trending_products(14, 48) where product_id::text like 'f4300000%' order by score desc limit 1),
  'paid order + save + view puts the listing first, with its counts');
select pg_temp.ok((select count(*) = 2 from public.trending_products(14, 48) where product_id::text like 'f4300000%'), 'only listings with activity are ranked');
-- Older activity counts less: an order 30 days ago is outside a 14-day window; at 3 days it is worth half.
update public.orders set created_at = now() - interval '3 days' where id = :'o1';
select pg_temp.ok((select abs(score - (4 + 3 + 1)) < 0.01 from public.trending_products(14, 48) where product_id = 'f4300000-0000-4000-8000-0000000000aa'),
  'activity decays with a 3-day half-life');
update public.orders set created_at = now() - interval '30 days' where id = :'o1';
select pg_temp.ok((select orders = 0 from public.trending_products(14, 48) where product_id = 'f4300000-0000-4000-8000-0000000000aa'), 'activity outside the window is ignored');
update public.profiles set is_banned = true where id = 'e4311111-1111-4111-8111-111111111111';
select pg_temp.ok(not exists (select 1 from public.trending_products(14, 48) where product_id::text like 'f4300000%'), 'banned suppliers are never trending');
update public.profiles set is_banned = false where id = 'e4311111-1111-4111-8111-111111111111';

-- ── Pools ──
insert into public.trend_pools (id, product_id, title, destination_country, target_cents, deadline) values
 ('f4300000-0000-4000-8000-0000000000d1', 'f4300000-0000-4000-8000-0000000000aa', 'Hot pool 43', 'KE', 100000, now() + interval '10 days'),
 ('f4300000-0000-4000-8000-0000000000d2', 'f4300000-0000-4000-8000-0000000000bb', 'Quiet pool 43', 'KE', 100000, now() + interval '10 days');
insert into public.pool_members (pool_id, buyer_id, contribution_cents) values
 ('f4300000-0000-4000-8000-0000000000d1', 'e4322222-2222-4222-8222-222222222222', 20000),
 ('f4300000-0000-4000-8000-0000000000d1', 'e4333333-3333-4333-8333-333333333333', 20000);
select pg_temp.ok((select pool_id = 'f4300000-0000-4000-8000-0000000000d1' and recent_pledges = 2 from public.trending_pools(100) where pool_id::text like 'f4300000%' order by score desc limit 1),
  'the pool with recent pledges ranks first');
select pg_temp.ok((select count(*) = 2 from public.trending_pools(100) where pool_id::text like 'f4300000%'), 'every open pool is listed, quiet ones last');

-- ── Retention ──
update public.product_interactions set created_at = now() - interval '91 days' where user_id = 'e4333333-3333-4333-8333-333333333333';
select pg_temp.ok(public.prune_product_interactions() >= 1, 'records older than 90 days are pruned');
select pg_temp.as_user('');
