-- Migration 030: follow suppliers. Own rows only (read / insert / delete), suppliers only, no self-follow,
-- no banned targets, no updates, and the public count never leaks who follows.
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
create or replace function pg_temp.n_follows() returns integer language sql as $$ select count(*)::integer from public.follows $$;
create or replace function pg_temp.unfollow(target uuid) returns integer language plpgsql as $$
declare n integer; begin delete from public.follows where following_id = target; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3011111-1111-4111-8111-111111111111', 's30@x.test',  '{"role":"supplier","full_name":"Sup 30","company_name":"Sup 30 Co","country_code":"CN"}'),
 ('e3022222-2222-4222-8222-222222222222', 'sb30@x.test', '{"role":"supplier","full_name":"Banned 30","company_name":"Banned 30 Co","country_code":"CN"}'),
 ('e3033333-3333-4333-8333-333333333333', 'b30@x.test',  '{"role":"importer","full_name":"Buyer 30","company_name":"Buyer 30 Co","country_code":"KE"}'),
 ('e3044444-4444-4444-8444-444444444444', 'c30@x.test',  '{"role":"importer","full_name":"Other 30","company_name":"Other 30 Co","country_code":"NG"}');
update public.profiles set is_banned = true where id = 'e3022222-2222-4222-8222-222222222222';

set role authenticated;
select pg_temp.as_user('e3033333-3333-4333-8333-333333333333');
insert into public.follows (follower_id, following_id) values ('e3033333-3333-4333-8333-333333333333', 'e3011111-1111-4111-8111-111111111111');
select pg_temp.ok(pg_temp.n_follows() = 1, 'buyer follows a supplier and sees the row');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e3033333-3333-4333-8333-333333333333', 'e3011111-1111-4111-8111-111111111111')$q$, 'duplicate key');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e3044444-4444-4444-8444-444444444444', 'e3011111-1111-4111-8111-111111111111')$q$, 'row-level security');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e3033333-3333-4333-8333-333333333333', 'e3044444-4444-4444-8444-444444444444')$q$, 'row-level security');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e3033333-3333-4333-8333-333333333333', 'e3022222-2222-4222-8222-222222222222')$q$, 'row-level security');
select pg_temp.fails($q$update public.follows set created_at = now() - interval '1 day'$q$, 'permission denied');

select pg_temp.as_user('e3044444-4444-4444-8444-444444444444');
select pg_temp.ok(pg_temp.n_follows() = 0, 'another user cannot read the follow');
select pg_temp.ok(pg_temp.unfollow('e3011111-1111-4111-8111-111111111111') = 0, 'another user cannot delete the follow');
insert into public.follows (follower_id, following_id) values ('e3044444-4444-4444-8444-444444444444', 'e3011111-1111-4111-8111-111111111111');
select pg_temp.ok(public.supplier_follower_count('e3011111-1111-4111-8111-111111111111') = 2, 'follower count includes rows the caller cannot read');

select pg_temp.as_user('e3011111-1111-4111-8111-111111111111');
select pg_temp.ok(pg_temp.n_follows() = 0, 'the supplier cannot list who follows them');
select pg_temp.fails($q$insert into public.follows (follower_id, following_id) values ('e3011111-1111-4111-8111-111111111111', 'e3011111-1111-4111-8111-111111111111')$q$, 'follows_not_self|row-level security');

select pg_temp.as_user('e3033333-3333-4333-8333-333333333333');
select pg_temp.ok(pg_temp.unfollow('e3011111-1111-4111-8111-111111111111') = 1, 'buyer unfollows');
select pg_temp.ok(public.supplier_follower_count('e3011111-1111-4111-8111-111111111111') = 1, 'count drops after unfollow');
reset role;

set role anon;
select pg_temp.fails($q$select public.supplier_follower_count('e3011111-1111-4111-8111-111111111111')$q$, 'permission denied');
select pg_temp.fails($q$select count(*) from public.follows$q$, 'permission denied');
reset role;
select 'ALL 030 CHECKS PASSED' as result;
