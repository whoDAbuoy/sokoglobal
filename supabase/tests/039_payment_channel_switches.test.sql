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
 ('e3911111-1111-4111-8111-111111111111', 's39@x.test',  '{"role":"supplier","full_name":"Sup 39","company_name":"Sup 39 Co","country_code":"CN"}'),
 ('e3922222-2222-4222-8222-222222222222', 'b39@x.test',  '{"role":"importer","full_name":"Buyer 39","company_name":"Buyer 39 Co","country_code":"KE"}'),
 ('e3944444-4444-4444-8444-444444444444', 'sa39@x.test', '{"role":"importer","full_name":"Finance 39","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e39%';
update public.profiles set role = 'super_admin' where id = 'e3944444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values ('f3900000-0000-4000-8000-000000000001', 'pay-39', 'Pay 39');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f3900000-0000-4000-8000-0000000000aa', 'e3911111-1111-4111-8111-111111111111', 'general', 'f3900000-0000-4000-8000-000000000001', 'Pay 39 widget', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── Settings ──
select pg_temp.ok((select enable_card and enable_mpesa from public.platform_settings where id), 'card and M-Pesa default on');
select pg_temp.as_user('e3922222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.super_set_payment_settings('{"enable_card": false}')$q$, 'Super admin');
select pg_temp.as_user('e3944444-4444-4444-8444-444444444444');
select pg_temp.fails($q$select public.super_set_payment_settings('{"enable_mpesa": "no"}')$q$, 'true or false');
select pg_temp.ok(not (public.super_set_payment_settings('{"enable_card": false, "enable_mpesa": false}', '10.0.0.39', 'test')).enable_card, 'super admin turns card and M-Pesa off');
select pg_temp.ok((select (detail -> 'to' -> 'flags' ->> 5)::boolean = false and (detail -> 'to' -> 'flags' ->> 6)::boolean = false
                     from public.admin_audit_logs where action = 'platform.payments' and ip = '10.0.0.39'), 'the switch change is audited');
select pg_temp.ok(not public.gateway_enabled('paystack'), 'gateway_enabled(paystack) follows the card switch');

-- ── Enforcement ──
select pg_temp.as_user('e3922222-2222-4222-8222-222222222222');
select (public.create_trial_order('f3900000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.begin_card_payment('order', %L, 'e3922222-2222-4222-8222-222222222222', 'USD', 1)$q$, :'o1'), 'Card payments are turned off');
select pg_temp.fails(format($q$select public.begin_mpesa_payment(%L, 'e3922222-2222-4222-8222-222222222222', '254712345678', 129.25, 250000)$q$, :'o1'), 'M-Pesa is turned off');
select pg_temp.ok((select count(*) = 0 from public.card_payments where order_id = :'o1') and (select count(*) = 0 from public.mpesa_payments where order_id = :'o1'),
  'nothing is recorded while the channels are off');

update public.platform_settings set enable_card = true, enable_mpesa = true where id;
select pg_temp.ok((public.begin_card_payment('order', :'o1', 'e3922222-2222-4222-8222-222222222222', 'USD', 1)).provider = 'paystack', 'card works again once switched back on');
select pg_temp.ok((public.begin_mpesa_payment(:'o1', 'e3922222-2222-4222-8222-222222222222', '254712345678', 129.25, 250000)).status = 'initiating', 'M-Pesa works again once switched back on');

-- Leave the shared settings row as the other test files expect it.
update public.platform_settings set enable_card = true, enable_mpesa = true where id;
