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
 ('e4011111-1111-4111-8111-111111111111', 's40@x.test', '{"role":"supplier","full_name":"Sup 40","company_name":"Sup 40 Co","country_code":"CN","terms_version":"2026-10-27","terms_accepted_at":"2001-01-01T00:00:00Z"}'),
 ('e4022222-2222-4222-8222-222222222222', 'b40@x.test', '{"role":"importer","full_name":"Buyer 40","company_name":"Buyer 40 Co","country_code":"KE"}'),
 ('e4033333-3333-4333-8333-333333333333', 'n40@x.test', '{"role":"importer","full_name":"New 40","company_name":"New 40 Co","country_code":"KE","terms_version":"2026-10-27"}'),
 ('e4044444-4444-4444-8444-444444444444', 'a40@x.test', '{"role":"importer","full_name":"Staff 40","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e40%';
update public.profiles set role = 'admin' where id = 'e4044444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values ('f4000000-0000-4000-8000-000000000001', 'cat-40', 'Cat 40');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f4000000-0000-4000-8000-0000000000aa', 'e4011111-1111-4111-8111-111111111111', 'general', 'f4000000-0000-4000-8000-000000000001', 'Widget 40', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── Terms ──
select pg_temp.ok((select terms_version = '2026-10-27' and abs(extract(epoch from terms_accepted_at - now())) < 60 from public.profiles where id = 'e4011111-1111-4111-8111-111111111111'),
  'sign-up metadata is copied to the profile; an implausible browser timestamp is replaced by now()');
select pg_temp.ok((select terms_version is null from public.profiles where id = 'e4022222-2222-4222-8222-222222222222'), 'no metadata → no acceptance recorded');
select pg_temp.as_user('');
select pg_temp.fails($q$select public.accept_terms('2026-10-27')$q$, 'Sign in first');
select pg_temp.as_user('e4022222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.accept_terms('latest')$q$, 'Unknown terms version');
select pg_temp.ok(public.accept_terms('2026-10-27') is not null, 'accept_terms records the version for the caller');
select pg_temp.ok((select terms_version = '2026-10-27' from public.profiles where id = 'e4022222-2222-4222-8222-222222222222'), 'version stored');
set role authenticated;
select pg_temp.fails($q$update public.profiles set terms_version = '2099-01-01' where id = auth.uid()$q$, 'permission denied');
reset role;

-- ── Closure blockers ──
select (public.create_trial_order('f4000000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select pg_temp.ok(public.my_account_closure_blockers() ? 'open_orders', 'an unfinished order blocks closing the buyer account');
select pg_temp.fails($q$select public.close_my_account()$q$, 'cannot be closed yet');
update public.orders set escrow_status = 'cancelled' where id = :'o1';
select pg_temp.ok(public.my_account_closure_blockers() = '{}'::jsonb, 'nothing blocks once the order is finished');
select pg_temp.as_user('e4044444-4444-4444-8444-444444444444');
select pg_temp.ok(public.my_account_closure_blockers() ? 'staff', 'staff accounts cannot close themselves');

-- ── Closing ──
select pg_temp.as_user('e4022222-2222-4222-8222-222222222222');
insert into public.follows (follower_id, following_id) values ('e4022222-2222-4222-8222-222222222222', 'e4011111-1111-4111-8111-111111111111');
select pg_temp.ok((public.close_my_account() ->> 'has_history')::boolean, 'buyer with an order history: anonymised, records kept');
select pg_temp.ok((select full_name = 'Closed account' and company_name = 'Closed account' and is_banned and closed_at is not null and phone_number is null
                     from public.profiles where id = 'e4022222-2222-4222-8222-222222222222'), 'profile anonymised and blocked from sign-in');
select pg_temp.ok(exists (select 1 from public.orders where id = :'o1'), 'order record kept');
select pg_temp.ok(not exists (select 1 from public.follows where follower_id = 'e4022222-2222-4222-8222-222222222222'), 'follows removed');
select pg_temp.ok(exists (select 1 from public.admin_user_log where target_user_id = 'e4022222-2222-4222-8222-222222222222' and action = 'close_account'
                            and detail ->> 'full_name' = 'Buyer 40'), 'closure is logged with the old name');
select pg_temp.ok((public.close_my_account() ->> 'closed')::boolean, 'closing twice is harmless');

select pg_temp.as_user('e4033333-3333-4333-8333-333333333333');
select pg_temp.ok(not (public.close_my_account() ->> 'has_history')::boolean, 'an account with no history can be deleted outright');

select pg_temp.as_user('e4011111-1111-4111-8111-111111111111');
select pg_temp.ok((public.close_my_account() ->> 'has_history')::boolean, 'supplier with listings keeps its history');
select pg_temp.ok((select status::text = 'archived' from public.products where id = 'f4000000-0000-4000-8000-0000000000aa'), 'supplier closure archives its listings');
select pg_temp.as_user('');
