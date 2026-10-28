-- Migration 042: 2FA on every table, product-media uploads tied to own draft listings, server-only KYC document rows.
-- Run with `npm run test:db` (scripts/db-test.mjs). Own users; independent of the other test files.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- A signed-in user with a given JWT session id, as PostgREST sets it.
create or replace function pg_temp.as_session(u text, sess text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false),
         set_config('request.jwt.claims', json_build_object('sub', u, 'session_id', sess)::text, false) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e4211111-1111-4111-8111-111111111111', 's42@x.test', '{"role":"supplier","full_name":"Sup 42","company_name":"Sup 42 Co","country_code":"CN"}'),
 ('e4222222-2222-4222-8222-222222222222', 'b42@x.test', '{"role":"importer","full_name":"Buyer 42","company_name":"Buyer 42 Co","country_code":"KE"}'),
 ('e4233333-3333-4333-8333-333333333333', 'p42@x.test', '{"role":"supplier","full_name":"Pending 42","company_name":"Pending 42 Co","country_code":"US"}');
update public.profiles set kyc_status = 'approved' where id in ('e4211111-1111-4111-8111-111111111111', 'e4222222-2222-4222-8222-222222222222');
insert into public.categories (id, slug, name) values ('f4200000-0000-4000-8000-000000000001', 'cat-42', 'Cat 42');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f4200000-0000-4000-8000-0000000000aa', 'e4211111-1111-4111-8111-111111111111', 'general', 'f4200000-0000-4000-8000-000000000001', 'Live 42', 'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f4200000-0000-4000-8000-0000000000bb', 'e4211111-1111-4111-8111-111111111111', 'general', 'f4200000-0000-4000-8000-000000000001', 'Draft 42', 'CN', 500, 100, 50000, 5000, 2000, 'draft');

-- ── Two-factor on every table ──
select pg_temp.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname not in ('profiles', 'platform_settings', 'exchange_rates', 'system_configs', 'categories')
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                       and p.policyname = 'two-factor: verified sessions only' and p.permissive = 'RESTRICTIVE')),
  'every table with RLS (except profiles and public settings) carries the restrictive 2FA policy');

select pg_temp.as_session('e4222222-2222-4222-8222-222222222222', 'c4200000-0000-4000-8000-000000000001');
select (public.create_trial_order('f4200000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.orders where id = :'o1'), 'a buyer without 2FA sees their own order');
reset role;

update public.profiles set two_factor_enabled = true where id = 'e4222222-2222-4222-8222-222222222222';
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.orders where id = :'o1'),
  'with 2FA on and the code not yet entered, the order is invisible (so embedding through /profiles returns nothing)');
select pg_temp.ok((select count(*) = 1 from public.profiles where id = auth.uid()), 'the pending session can still read its own profile');
reset role;
insert into public.two_factor_sessions (session_id, user_id, method, expires_at)
values ('c4200000-0000-4000-8000-000000000001', 'e4222222-2222-4222-8222-222222222222', 'totp', now() + interval '12 hours');
set role authenticated;
select pg_temp.ok((select count(*) = 1 from public.orders where id = :'o1'), 'after the code, the order is visible again');
reset role;

-- ── product-media uploads ──
select pg_temp.as_session('e4211111-1111-4111-8111-111111111111', 'c4200000-0000-4000-8000-000000000002');
set role authenticated;
select pg_temp.ok(public.may_upload_listing_media('e4211111-1111-4111-8111-111111111111/f4200000-0000-4000-8000-0000000000bb/a.png'),
  'a supplier may upload to their own draft listing');
select pg_temp.ok(not public.may_upload_listing_media('e4211111-1111-4111-8111-111111111111/f4200000-0000-4000-8000-0000000000aa/a.png'),
  'not to a live listing (media is locked once submitted)');
select pg_temp.ok(not public.may_upload_listing_media('e4211111-1111-4111-8111-111111111111/anything/a.html'),
  'not to a folder that is not one of their listings');
select pg_temp.ok(not public.may_upload_listing_media('e4211111-1111-4111-8111-111111111111/a.png'), 'not loose in their root folder');
reset role;
select pg_temp.as_session('e4233333-3333-4333-8333-333333333333', 'c4200000-0000-4000-8000-000000000003');
set role authenticated;
select pg_temp.ok(not public.may_upload_listing_media('e4233333-3333-4333-8333-333333333333/f4200000-0000-4000-8000-0000000000bb/a.png'),
  'a supplier awaiting KYC cannot upload (and never into another supplier''s listing)');
reset role;
select pg_temp.as_session('e4222222-2222-4222-8222-222222222222', 'c4200000-0000-4000-8000-000000000001');
set role authenticated;
select pg_temp.ok(not public.may_upload_listing_media('e4222222-2222-4222-8222-222222222222/f4200000-0000-4000-8000-0000000000bb/a.png'),
  'buyers cannot upload listing media');
reset role;

-- ── KYC documents ──
select pg_temp.ok(not has_table_privilege('authenticated', 'public.kyc_documents', 'insert'), 'the browser can no longer insert KYC document rows');
select pg_temp.as_session('', '');
