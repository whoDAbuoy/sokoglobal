-- Migration 034: complimentary Gold grants. Super admins only; suppliers only; reason and 1–24 months required;
-- extends a running period, restarts a lapsed one; revoke ends it now; every call is audited; no revenue recorded.
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
create or replace function pg_temp.gold_end() returns timestamptz language sql security definer as $$
  select current_period_end from public.subscriptions where user_id = 'e3411111-1111-4111-8111-111111111111' and plan_type = 'gold_supplier' and status = 'active'
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3411111-1111-4111-8111-111111111111', 'Gold34@X.test', '{"role":"supplier","full_name":"Sup 34","company_name":"Sup 34 Co","country_code":"CN"}'),
 ('e3422222-2222-4222-8222-222222222222', 'buyer34@x.test', '{"role":"importer","full_name":"Buyer 34","company_name":"Buyer 34 Co","country_code":"KE"}'),
 ('e3433333-3333-4333-8333-333333333333', 'admin34@x.test', '{"role":"importer","full_name":"Admin 34","company_name":"Ops 34","country_code":"KE"}'),
 ('e3444444-4444-4444-8444-444444444444', 'super34@x.test', '{"role":"importer","full_name":"Super 34","company_name":"Ops 34","country_code":"KE"}'),
 ('e3455555-5555-4555-8555-555555555555', 'banned34@x.test', '{"role":"supplier","full_name":"Banned 34","company_name":"Banned 34 Co","country_code":"CN"}');
update public.profiles set role = 'admin' where id = 'e3433333-3333-4333-8333-333333333333';
update public.profiles set role = 'super_admin' where id = 'e3444444-4444-4444-8444-444444444444';
update public.profiles set is_banned = true where id = 'e3455555-5555-4555-8555-555555555555';

set role authenticated;
-- Only super admins.
select pg_temp.as_user('e3411111-1111-4111-8111-111111111111');
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 12, 'Give myself gold')$q$, 'Super admin access required');
select pg_temp.as_user('e3433333-3333-4333-8333-333333333333');
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 12, 'Ordinary admin tries')$q$, 'Super admin access required');
select pg_temp.fails($q$select public.super_revoke_gold('gold34@x.test', 'Ordinary admin tries')$q$, 'Super admin access required');
select pg_temp.fails($q$select public.gold_target_supplier('gold34@x.test')$q$, 'permission denied');
select pg_temp.fails($q$insert into public.subscriptions (user_id, plan_type, current_period_end) values ('e3433333-3333-4333-8333-333333333333', 'gold_supplier', now() + interval '1 year')$q$, 'permission denied');

-- Validation.
select pg_temp.as_user('e3444444-4444-4444-8444-444444444444');
select pg_temp.fails($q$select public.super_grant_gold('nobody34@x.test', 12, 'Launch partner')$q$, 'No account uses that email');
select pg_temp.fails($q$select public.super_grant_gold('buyer34@x.test', 12, 'Launch partner')$q$, 'supplier accounts; buyer34@x.test is a buyer account');
select pg_temp.fails($q$select public.super_grant_gold('banned34@x.test', 12, 'Launch partner')$q$, 'suspended');
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 0, 'Launch partner')$q$, 'between 1 and 24 months');
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 25, 'Launch partner')$q$, 'between 1 and 24 months');
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 12, '  ok ')$q$, 'Give a reason');
select pg_temp.fails($q$select public.super_revoke_gold('gold34@x.test', 'Nothing to revoke yet')$q$, 'does not have active Gold');

-- Grant (email match ignores case and spaces), then extend.
select pg_temp.ok((select (public.super_grant_gold('  GOLD34@x.test ', 12, 'Launch partner', '10.0.0.34', 'test-ua') ->> 'company_name') = 'Sup 34 Co'), 'super admin grants Gold by email');
select pg_temp.ok(public.is_gold_supplier('e3411111-1111-4111-8111-111111111111'), 'the supplier is Gold');
select pg_temp.ok(pg_temp.gold_end() between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute', 'grant lasts 12 months from now');
select public.super_grant_gold('gold34@x.test', 2, 'Extension for referral');
select pg_temp.ok(pg_temp.gold_end() between now() + interval '14 months' - interval '1 minute' and now() + interval '14 months' + interval '1 minute', 'a second grant extends the running period');
reset role;
select pg_temp.ok((select actor_id = 'e3444444-4444-4444-8444-444444444444' and target_id = 'e3411111-1111-4111-8111-111111111111'
                          and detail ->> 'months' = '12' and detail ->> 'reason' = 'Launch partner' and ip = '10.0.0.34' and user_agent = 'test-ua'
                     from public.admin_audit_logs where action = 'subscription.gold_granted' and target_id = 'e3411111-1111-4111-8111-111111111111' order by id limit 1),
  'the grant is audited with actor, target, months, reason, IP and user agent');
select pg_temp.ok((select count(*) from public.admin_audit_logs where action = 'subscription.gold_granted' and target_id = 'e3411111-1111-4111-8111-111111111111') = 2, 'every grant is audited');
select pg_temp.ok(not exists (select 1 from public.card_payments where buyer_id = 'e3411111-1111-4111-8111-111111111111'), 'no payment is recorded, so revenue is unchanged');

-- A lapsed period restarts from now instead of stacking on the past.
update public.subscriptions set status = 'past_due', current_period_end = now() - interval '3 months' where user_id = 'e3411111-1111-4111-8111-111111111111';
set role authenticated;
select pg_temp.as_user('e3444444-4444-4444-8444-444444444444');
select public.super_grant_gold('gold34@x.test', 1, 'Welcome back');
select pg_temp.ok(pg_temp.gold_end() between now() + interval '1 month' - interval '1 minute' and now() + interval '1 month' + interval '1 minute', 'a lapsed subscription restarts from now');

-- Revoke.
select public.super_revoke_gold('gold34@x.test', 'Granted to the wrong account');
select pg_temp.ok(not public.is_gold_supplier('e3411111-1111-4111-8111-111111111111'), 'revoke ends Gold immediately');
select pg_temp.fails($q$select public.super_revoke_gold('gold34@x.test', 'Again')$q$, 'does not have active Gold');
reset role;
select pg_temp.ok((select detail ->> 'reason' from public.admin_audit_logs where action = 'subscription.gold_revoked' and target_id = 'e3411111-1111-4111-8111-111111111111') = 'Granted to the wrong account',
  'the revoke is audited with its reason');

set role anon;
select pg_temp.fails($q$select public.super_grant_gold('gold34@x.test', 1, 'Anonymous grant')$q$, 'permission denied');
reset role;

select 'ALL 034 CHECKS PASSED' as result;
