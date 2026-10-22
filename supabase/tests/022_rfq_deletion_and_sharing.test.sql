-- Migration 022: who can delete RFQs, who can read live RFQs, and the supplier feed.
-- Run with `npm run test:db` (scripts/db-test.mjs). Independent of the 021 test (own users).
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
-- Rows a DELETE actually removed (RLS silently skips rows you may not delete).
create or replace function pg_temp.deleted(rfq uuid) returns integer language plpgsql as $$
declare n integer; begin delete from public.rfqs where id = rfq; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('a1111111-1111-4111-8111-111111111111', 's22@x.test', '{"role":"supplier","full_name":"Sup A","company_name":"Sup A Co","country_code":"US"}'),
 ('a2222222-2222-4222-8222-222222222222', 'b22@x.test', '{"role":"importer","full_name":"Buyer A","company_name":"Buyer A Co","country_code":"KE"}'),
 ('a3333333-3333-4333-8333-333333333333', 'o22@x.test', '{"role":"supplier","full_name":"Other Sup","company_name":"Other Co","country_code":"US"}'),
 ('a4444444-4444-4444-8444-444444444444', 'x22@x.test', '{"role":"importer","full_name":"Buyer B","company_name":"Buyer B Co","country_code":"UG"}'),
 ('a5555555-5555-4555-8555-555555555555', 'sa22@x.test', '{"role":"importer","full_name":"Super Admin","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'a%';
update public.profiles set role = 'super_admin' where id = 'a5555555-5555-4555-8555-555555555555';

insert into public.categories (id, slug, name) values ('cccccccc-0000-4000-8000-000000000001', 'tools-22', 'Tools 22'), ('cccccccc-0000-4000-8000-000000000002', 'food-22', 'Food 22');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('dddddddd-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111', 'general', 'cccccccc-0000-4000-8000-000000000001', 'Hand tools', 'US', 500, 100, 50000, 5000, 2000, 'live'),
       ('dddddddd-0000-4000-8000-000000000002', 'a3333333-3333-4333-8333-333333333333', 'general', 'cccccccc-0000-4000-8000-000000000002', 'Dried fruit', 'US', 500, 100, 50000, 5000, 2000, 'live');

select pg_temp.as_user('a2222222-2222-4222-8222-222222222222');
select (public.submit_rfq('Spanner sets', 'Need 200 spanner sets, metric', 200, 'Nairobi', null, 'cccccccc-0000-4000-8000-000000000001')).id as r_open \gset
select (public.submit_rfq('Hammers', 'Need 300 claw hammers, steel', 300, 'Nairobi', null, 'cccccccc-0000-4000-8000-000000000001')).id as r_quoted \gset
select (public.submit_rfq('Pliers', 'Need 100 pliers, insulated', 100, 'Nairobi', null, 'cccccccc-0000-4000-8000-000000000001')).id as r_accepted \gset
select (public.submit_rfq('Screwdrivers', 'Need 50 screwdriver kits', 50, 'Nairobi', null, 'cccccccc-0000-4000-8000-000000000001')).id as r_closed \gset
select public.close_rfq(:'r_closed') \gset
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select (public.submit_rfq_quote(:'r_quoted', 'dddddddd-0000-4000-8000-000000000001', 400, 10, now() + interval '5 days')).id as q_quoted \gset
select (public.submit_rfq_quote(:'r_accepted', 'dddddddd-0000-4000-8000-000000000001', 50000, 10, now() + interval '5 days', null, '[]', array['full'])).id as q_acc \gset
select pg_temp.as_user('a2222222-2222-4222-8222-222222222222');
select (public.accept_rfq_quote(:'q_acc', 'full')).id as acc_order \gset

-- ── Visibility ──
set role authenticated;
select pg_temp.as_user('a3333333-3333-4333-8333-333333333333');
select pg_temp.ok((select count(*) from public.rfqs where buyer_id = 'a2222222-2222-4222-8222-222222222222') = 2, 'a supplier outside the category sees live (open + quoted) requests');
select pg_temp.ok(not exists (select 1 from public.rfqs where id in (:'r_accepted', :'r_closed')), 'accepted and closed requests stay hidden');
select pg_temp.ok((select count(*) from public.supplier_rfq_feed() f where f.id in (:'r_open', :'r_quoted') and not f.can_quote) = 2, 'feed lists them, flagged as not quotable');
select pg_temp.ok((select count(*) from public.rfq_quotes) = 0, 'other suppliers still cannot see quotes');
select pg_temp.as_user('a4444444-4444-4444-8444-444444444444');
select pg_temp.ok((select count(*) from public.rfqs where id = :'r_quoted') = 1, 'any signed-in user can open a shared link to a live request');
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select pg_temp.ok((select bool_and(can_quote) from public.supplier_rfq_feed() f where f.id in (:'r_open', :'r_quoted')), 'matching supplier can quote');
reset role;
set role anon;
select pg_temp.ok((select count(*) from public.rfqs) = 0, 'signed-out visitors read nothing (policies are for signed-in users)');
reset role;

-- Expired requests disappear for others even before the cron runs.
update public.rfqs set created_at = now() - interval '10 days', expires_at = now() - interval '1 minute' where id = :'r_open';
set role authenticated;
select pg_temp.as_user('a4444444-4444-4444-8444-444444444444');
select pg_temp.ok(not exists (select 1 from public.rfqs where id = :'r_open'), 'expired request is hidden from others');
select pg_temp.as_user('a2222222-2222-4222-8222-222222222222');
select pg_temp.ok(exists (select 1 from public.rfqs where id = :'r_open'), 'buyer still sees own expired request');
reset role;
update public.rfqs set expires_at = now() + interval '5 days' where id = :'r_open';

-- ── Deletion ──
set role authenticated;
select pg_temp.as_user('a4444444-4444-4444-8444-444444444444');
select pg_temp.ok(pg_temp.deleted(:'r_open') = 0, 'another buyer cannot delete it');
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111');
select pg_temp.ok(pg_temp.deleted(:'r_quoted') = 0, 'a supplier cannot delete it');
select pg_temp.as_user('a2222222-2222-4222-8222-222222222222');
select pg_temp.ok(pg_temp.deleted(:'r_accepted') = 0, 'buyer cannot delete an accepted request');
select pg_temp.ok(pg_temp.deleted(:'r_closed') = 1, 'buyer deletes own closed request (023)');
select pg_temp.ok(pg_temp.deleted(:'r_open') = 1, 'buyer deletes own open request');
reset role;

set role authenticated;
select pg_temp.as_user('a5555555-5555-4555-8555-555555555555');
select pg_temp.ok(pg_temp.deleted(:'r_quoted') = 1, 'super admin deletes someone else''s quoted request');
select pg_temp.fails(format($q$select pg_temp.deleted(%L)$q$, :'r_accepted'), 'became order');
reset role;
select pg_temp.ok(not exists (select 1 from public.rfq_quotes where id = :'q_quoted'), 'its pending quotes are removed with it');
select pg_temp.ok(exists (select 1 from public.admin_audit_logs where action = 'rfq.delete' and target_id = :'r_quoted'), 'admin delete is audited');
select pg_temp.ok(not exists (select 1 from public.admin_audit_logs where action = 'rfq.delete' and target_id in (:'r_open', :'r_closed')), 'buyer deletes are not admin-audited');
select pg_temp.ok(exists (select 1 from public.orders where id = :'acc_order' and rfq_quote_id = :'q_acc'), 'the escrow order keeps its quote');
select 'ALL 022 CHECKS PASSED' as result;
