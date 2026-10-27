-- Migration 041: supplier columns, two-factor on every API request, 2FA lockout, admin overview figures.
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
-- A PostgREST request: path, method and the JWT (sub + session_id), as PostgREST sets them before check_request().
create or replace function pg_temp.request(u text, sess text, method text, path text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', false),
         set_config('request.jwt.claims', case when u = '' then '{}' else json_build_object('sub', u, 'session_id', sess)::text end, false),
         set_config('request.method', method, false), set_config('request.path', path, false) $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e4111111-1111-4111-8111-111111111111', 's41@x.test', '{"role":"supplier","full_name":"Sup 41","company_name":"Sup 41 Co","country_code":"CN"}'),
 ('e4122222-2222-4222-8222-222222222222', 'b41@x.test', '{"role":"importer","full_name":"Buyer 41","company_name":"Buyer 41 Co","country_code":"KE"}'),
 ('e4133333-3333-4333-8333-333333333333', 't41@x.test', '{"role":"importer","full_name":"Tfa 41","company_name":"Tfa 41 Co","country_code":"KE"}'),
 ('e4144444-4444-4444-8444-444444444444', 'a41@x.test', '{"role":"importer","full_name":"Admin 41","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved', phone_number = '+8613800000000', ban_reason = null where id = 'e4111111-1111-4111-8111-111111111111';
update public.profiles set kyc_status = 'approved' where id::text like 'e41%';
update public.profiles set two_factor_enabled = true where id = 'e4133333-3333-4333-8333-333333333333';
update public.profiles set role = 'admin' where id = 'e4144444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values ('f4100000-0000-4000-8000-000000000001', 'cat-41', 'Cat 41');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f4100000-0000-4000-8000-0000000000aa', 'e4111111-1111-4111-8111-111111111111', 'beauty', 'f4100000-0000-4000-8000-000000000001', 'Widget 41', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── Supplier profiles ──
select pg_temp.as_user('e4122222-2222-4222-8222-222222222222');
set role authenticated;
select pg_temp.ok(not exists (select 1 from public.profiles where id = 'e4111111-1111-4111-8111-111111111111'), 'a buyer cannot read a supplier''s profile row');
select pg_temp.ok((select company_name = 'Sup 41 Co' and kyc_verified from public.supplier_profiles where id = 'e4111111-1111-4111-8111-111111111111'),
  'the supplier''s public columns come from supplier_profiles');
select pg_temp.ok(not exists (select 1 from public.supplier_profiles where id = 'e4122222-2222-4222-8222-222222222222'), 'buyers are not in supplier_profiles');
select pg_temp.ok(exists (select 1 from public.profiles where id = auth.uid()), 'own profile still readable');
insert into public.follows (follower_id, following_id) values ('e4122222-2222-4222-8222-222222222222', 'e4111111-1111-4111-8111-111111111111');
select pg_temp.ok(exists (select 1 from public.follows where following_id = 'e4111111-1111-4111-8111-111111111111'),
  'following a supplier still works (the policy checks supplier_profiles, not the hidden profile row)');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e4122222-2222-4222-8222-222222222222', 'e4133333-3333-4333-8333-333333333333')$q$, 'row-level security');
reset role;
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_profiles'
                                and column_name in ('phone_number', 'ban_reason', 'freeze_reason', 'kyc_status', 'email_notifications', 'sms_alerts')),
  'contact details, moderation reasons and settings are not in the view');
select pg_temp.ok(not has_table_privilege('anon', 'public.supplier_profiles', 'select'), 'signed-out visitors use the public_* functions, not the view');
select pg_temp.as_user('e4144444-4444-4444-8444-444444444444');
set role authenticated;
select pg_temp.ok((select phone_number = '+8613800000000' from public.profiles where id = 'e4111111-1111-4111-8111-111111111111'), 'admins still read every column');
reset role;

-- ── check_request (PostgREST pre-request) ──
select pg_temp.request('', '', 'GET', '/products');
select public.check_request();
select pg_temp.request('e4122222-2222-4222-8222-222222222222', 'c4100000-0000-4000-8000-000000000001', 'POST', '/rpc/create_cart_checkout');
select public.check_request();
select pg_temp.ok(true, 'anon and users without 2FA pass');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'GET', '/orders');
select pg_temp.fails($q$select public.check_request()$q$, 'Verify your two-factor code');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'POST', '/rpc/accept_rfq_quote');
select pg_temp.fails($q$select public.check_request()$q$, 'Verify your two-factor code');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'PATCH', '/profiles');
select pg_temp.fails($q$select public.check_request()$q$, 'Verify your two-factor code');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'GET', '/profiles');
select public.check_request();
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'POST', '/rpc/my_security_state');
select public.check_request();
select pg_temp.ok(true, 'a session waiting for its code may read its profile and security state only');
insert into public.two_factor_sessions (session_id, user_id, method, expires_at)
values ('c4100000-0000-4000-8000-000000000002', 'e4133333-3333-4333-8333-333333333333', 'totp', now() + interval '12 hours');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000002', 'GET', '/orders');
select public.check_request();
select pg_temp.ok(true, 'once the session passes the code, everything is allowed');
select pg_temp.request('e4133333-3333-4333-8333-333333333333', 'c4100000-0000-4000-8000-000000000003', 'GET', '/orders');
select pg_temp.fails($q$select public.check_request()$q$, 'Verify your two-factor code');
select pg_temp.request('', '', '', '');
select pg_temp.ok((select count(*) = 4 from pg_policies where policyname = 'two-factor: verified sessions only' and permissive = 'RESTRICTIVE'),
  'storage.objects and the three realtime tables carry the restrictive 2FA policy');

-- ── Lockout ──
set role authenticated;
select pg_temp.fails($q$select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333')$q$, 'permission denied');
reset role;
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') from generate_series(1, 4);
select pg_temp.ok(public.two_factor_locked_until('e4133333-3333-4333-8333-333333333333') is null, 'four wrong codes do not lock');
-- \gset first: BETWEEN would evaluate the (counting) call twice.
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') as lock5 \gset
select pg_temp.ok(:'lock5'::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes', 'the fifth wrong code locks for 15 minutes');
select pg_temp.ok(public.two_factor_locked_until('e4133333-3333-4333-8333-333333333333') > now(), 'locked_until reports the lock');
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') from generate_series(1, 4);
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') as lock10 \gset
select pg_temp.ok(:'lock10'::timestamptz between now() + interval '29 minutes' and now() + interval '31 minutes', 'the tenth doubles the lock to 30 minutes');
update public.two_factor_failures set failures = 5000 - 1 where user_id = 'e4133333-3333-4333-8333-333333333333';
select pg_temp.ok((select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') <= now() + interval '24 hours'), 'locks are capped at 24 hours');
update public.two_factor_failures set updated_at = now() - interval '2 days', locked_until = now() - interval '1 hour' where user_id = 'e4133333-3333-4333-8333-333333333333';
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333') is null as no_lock \gset
select pg_temp.ok(:'no_lock'::boolean and (select failures = 5001 from public.two_factor_failures where user_id = 'e4133333-3333-4333-8333-333333333333'),
  'the count does not start over right after a lock ends');
update public.two_factor_failures set updated_at = now() - interval '2 days', locked_until = now() - interval '2 days' where user_id = 'e4133333-3333-4333-8333-333333333333';
select public.record_two_factor_failure('e4133333-3333-4333-8333-333333333333');
select pg_temp.ok((select failures = 1 from public.two_factor_failures where user_id = 'e4133333-3333-4333-8333-333333333333'), 'a quiet day starts the count over');
select public.clear_two_factor_failures('e4133333-3333-4333-8333-333333333333');
select pg_temp.ok(not exists (select 1 from public.two_factor_failures where user_id = 'e4133333-3333-4333-8333-333333333333'), 'a correct code clears it');

-- ── Admin overview figures ── (other test files leave orders behind: compare before / after)
create or replace function pg_temp.metrics() returns jsonb language sql as $$ select public.admin_order_metrics() $$;
create or replace function pg_temp.d(a jsonb, b jsonb, path text[]) returns bigint language sql as $$
  select coalesce((b #>> path)::bigint, 0) - coalesce((a #>> path)::bigint, 0) $$;
create or replace function pg_temp.cat(m jsonb, c text) returns bigint language sql as $$
  select coalesce(sum((e ->> 'cents')::bigint), 0) from jsonb_array_elements(m -> 'by_category') e where e ->> 'category' = c $$;
create or replace function pg_temp.prov(m jsonb, p text) returns bigint language sql as $$
  select coalesce(sum((e ->> 'cents')::bigint), 0) from jsonb_array_elements(m -> 'month' -> 'by_provider') e where e ->> 'provider' = p $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.as_user('e4122222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.admin_order_metrics()$q$, 'Admin access required');
select pg_temp.as_user('e4144444-4444-4444-8444-444444444444');
set role authenticated;
select pg_temp.metrics() as m0 \gset
reset role;

select pg_temp.as_user('e4122222-2222-4222-8222-222222222222');
select (public.create_trial_order('f4100000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select (public.create_trial_order('f4100000-0000-4000-8000-0000000000aa', 1)).id as o2 \gset
select (public.create_trial_order('f4100000-0000-4000-8000-0000000000aa', 1)).id as o3 \gset
select (public.create_trial_order('f4100000-0000-4000-8000-0000000000aa', 1)).id as o4 \gset
select pg_temp.as_user('');
update public.orders set escrow_status = 'funded', funded_at = now() - interval '1 day', payment_provider = 'test41' where id = :'o1';
update public.orders set escrow_status = 'released', funded_at = now() - interval '40 days', payment_provider = 'paystack' where id = :'o2';
update public.orders set escrow_status = 'cancelled' where id = :'o3';
select total_cents as t from public.orders where id = :'o1' \gset
select category::text as c from public.products where id = 'f4100000-0000-4000-8000-0000000000aa' \gset
select to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD') as day \gset

select pg_temp.as_user('e4144444-4444-4444-8444-444444444444');
set role authenticated;
select pg_temp.metrics() as m1 \gset
reset role;
select pg_temp.ok(pg_temp.d(:'m0', :'m1', '{paid_count}') = 2, 'unpaid and cancelled-before-payment orders are not counted');
select pg_temp.ok(pg_temp.d(:'m0', :'m1', '{gmv}') = 2 * :t and pg_temp.d(:'m0', :'m1', '{held}') = :t and pg_temp.d(:'m0', :'m1', '{released}') = :t,
  'GMV, held and released are summed over every paid order');
select pg_temp.ok(pg_temp.d(:'m0', :'m1', '{buyers}') = 1 and pg_temp.d(:'m0', :'m1', '{repeat_buyers}') = 1, 'a new buyer with two paid orders is a repeat buyer');
select pg_temp.ok(pg_temp.d(:'m0', :'m1', '{month,gmv}') = :t and pg_temp.d(:'m0', :'m1', '{prev_month_gmv}') = :t, 'rolling 30-day windows');
select pg_temp.ok(pg_temp.prov(:'m1', 'test41') = :t, 'this month by payment provider');
select pg_temp.ok(pg_temp.cat(:'m1', :'c') - pg_temp.cat(:'m0', :'c') = 2 * :t, 'GMV by product category');
select pg_temp.ok(pg_temp.d(:'m0', :'m1', array['paid_days', :'day']) = 1, 'orders paid per UTC day');
select pg_temp.as_user('');
