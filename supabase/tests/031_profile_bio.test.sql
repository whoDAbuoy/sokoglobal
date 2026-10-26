-- Migration 031: profile bios + public profiles. Bio length check, own-bio updates only, sign-up stores a valid bio
-- (and drops an invalid one without blocking sign-up), public_profile() fields / counts / exclusions, anon denied.
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
create or replace function pg_temp.set_bio(target uuid, b text) returns integer language plpgsql as $$
declare n integer; begin update public.profiles set bio = b where id = target; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3111111-1111-4111-8111-111111111111', 's31@x.test',  '{"role":"supplier","full_name":"Sup 31","company_name":"Sup 31 Co","country_code":"cn","bio":"  We make organic shea butter for retailers.  "}'),
 ('e3122222-2222-4222-8222-222222222222', 'b31@x.test',  '{"role":"importer","full_name":"Buyer 31","company_name":"Buyer 31 Co","country_code":"KE","bio":"too short"}'),
 ('e3133333-3333-4333-8333-333333333333', 'x31@x.test',  '{"role":"supplier","full_name":"Banned 31","company_name":"Banned 31 Co","country_code":"CN"}'),
 ('e3144444-4444-4444-8444-444444444444', 'a31@x.test',  '{"role":"importer","full_name":"Admin 31","company_name":"Admin 31 Co","country_code":"KE"}');
update public.profiles set is_banned = true where id = 'e3133333-3333-4333-8333-333333333333';
update public.profiles set role = 'admin' where id = 'e3144444-4444-4444-8444-444444444444';
update public.profiles set kyc_status = 'approved' where id = 'e3111111-1111-4111-8111-111111111111';

select pg_temp.ok((select bio from public.profiles where id = 'e3111111-1111-4111-8111-111111111111') = 'We make organic shea butter for retailers.', 'sign-up stores a trimmed bio');
select pg_temp.ok((select bio from public.profiles where id = 'e3122222-2222-4222-8222-222222222222') is null, 'a too-short sign-up bio is dropped, sign-up still succeeds');
select pg_temp.fails($q$update public.profiles set bio = 'short' where id = 'e3111111-1111-4111-8111-111111111111'$q$, 'profiles_bio_len');
select pg_temp.fails($q$update public.profiles set bio = repeat('x', 501) where id = 'e3111111-1111-4111-8111-111111111111'$q$, 'profiles_bio_len');

insert into public.categories (id, slug, name) values ('f3100000-0000-4000-8000-000000000001', 'bio-31', 'Bio 31');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f3100000-0000-4000-8000-0000000000a1', 'e3111111-1111-4111-8111-111111111111', 'general', 'f3100000-0000-4000-8000-000000000001', 'Live 31',  'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f3100000-0000-4000-8000-0000000000a2', 'e3111111-1111-4111-8111-111111111111', 'general', 'f3100000-0000-4000-8000-000000000001', 'Draft 31', 'CN', 500, 100, 50000, 0, 0, 'draft');
insert into public.follows (follower_id, following_id) values ('e3122222-2222-4222-8222-222222222222', 'e3111111-1111-4111-8111-111111111111');

set role authenticated;
select pg_temp.as_user('e3122222-2222-4222-8222-222222222222');
select pg_temp.ok(pg_temp.set_bio('e3122222-2222-4222-8222-222222222222', 'Boutique in Nairobi stocking skincare.') = 1, 'a user sets their own bio');
select pg_temp.ok(pg_temp.set_bio('e3111111-1111-4111-8111-111111111111', 'Somebody else rewriting this bio.') = 0, 'a user cannot change another user''s bio');
select pg_temp.fails($q$update public.profiles set role = 'admin' where id = 'e3122222-2222-4222-8222-222222222222'$q$, 'permission denied');

select pg_temp.ok((select follower_count = 1 and following_count = 0 and live_listings = 1 and bio = 'We make organic shea butter for retailers.'
                     from public.public_profile('e3111111-1111-4111-8111-111111111111')), 'supplier profile: bio, 1 follower, 1 live listing (drafts not counted)');
select pg_temp.ok((select following_count = 1 and follower_count = 0 and bio = 'Boutique in Nairobi stocking skincare.'
                     from public.public_profile('e3122222-2222-4222-8222-222222222222')), 'importer profile is public through the function, with its following count');
select pg_temp.as_user('e3111111-1111-4111-8111-111111111111');
select pg_temp.ok(not exists (select 1 from public.profiles where id = 'e3122222-2222-4222-8222-222222222222'), 'importer rows stay unreadable directly (RLS unchanged)');
select pg_temp.ok(exists (select 1 from public.public_profile('e3122222-2222-4222-8222-222222222222')), 'but the importer''s public profile is readable');
select pg_temp.ok(not exists (select 1 from public.public_profile('e3133333-3333-4333-8333-333333333333')), 'banned accounts have no public profile');
select pg_temp.ok(not exists (select 1 from public.public_profile('e3144444-4444-4444-8444-444444444444')), 'admin accounts have no public profile');
select pg_temp.ok(not exists (select 1 from public.public_profile('00000000-0000-4000-8000-000000000000')), 'unknown id → no row');
reset role;

set role anon;
select pg_temp.fails($q$select * from public.public_profile('e3111111-1111-4111-8111-111111111111')$q$, 'permission denied');
reset role;
select 'ALL 031 CHECKS PASSED' as result;
