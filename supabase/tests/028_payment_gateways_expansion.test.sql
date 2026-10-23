-- Migration 028: payment settings (validation, audit), gateway charges on card_payments (DPO, PayPal, Airtel),
-- SWIFT wire and crypto manual payments (begin → submit → approve / reject), expiry grace and revenue.
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
 ('e2811111-1111-4111-8111-111111111111', 's28@x.test',  '{"role":"supplier","full_name":"Sup 28","company_name":"Sup 28 Co","country_code":"CN"}'),
 ('e2822222-2222-4222-8222-222222222222', 'b28@x.test',  '{"role":"importer","full_name":"Buyer 28","company_name":"Buyer 28 Co","country_code":"KE"}'),
 ('e2833333-3333-4333-8333-333333333333', 'x28@x.test',  '{"role":"importer","full_name":"Other 28","company_name":"Other 28 Co","country_code":"UG"}'),
 ('e2844444-4444-4444-8444-444444444444', 'sa28@x.test', '{"role":"importer","full_name":"Finance 28","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e28%';
update public.profiles set role = 'super_admin' where id = 'e2844444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values ('f2800000-0000-4000-8000-000000000001', 'pay-28', 'Pay 28');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f2800000-0000-4000-8000-0000000000aa', 'e2811111-1111-4111-8111-111111111111', 'general', 'f2800000-0000-4000-8000-000000000001', 'Pay 28 widget', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── Settings ──
select pg_temp.ok((select enable_dpo_pay and enable_airtel_money and enable_paypal and enable_swift_wire and not enable_crypto
                          and crypto_markup_percent = 0.01 and swift_bank_details ->> 'swift_code' = '' and crypto_deposit_wallets ? 'usdt_trc20'
                     from public.platform_settings where id), 'defaults: gateways and wire on, crypto off, 1% crypto fee');
select pg_temp.as_user('e2822222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.super_set_payment_settings('{"enable_crypto": true}')$q$, 'Super admin');
select pg_temp.as_user('e2844444-4444-4444-8444-444444444444');
select pg_temp.fails($q$select public.super_set_payment_settings('{"enable_crypto": "yes"}')$q$, 'true or false');
select pg_temp.fails($q$select public.super_set_payment_settings('{"swift_bank_details": {"swift_code": "BAD"}}')$q$, 'SWIFT/BIC');
select pg_temp.fails($q$select public.super_set_payment_settings('{"crypto_deposit_wallets": {"usdt_trc20": "0xabc"}}')$q$, 'TRC-20');
select pg_temp.fails($q$select public.super_set_payment_settings('{"crypto_deposit_wallets": {"usdc_polygon": "T123"}}')$q$, 'POLYGON address');
select pg_temp.fails($q$select public.super_set_payment_settings('{"crypto_markup_percent": 0.2}')$q$, 'between 0%');
select pg_temp.fails($q$select public.super_set_payment_settings('{"pause_checkout": true}')$q$, 'Unknown payment setting');
select pg_temp.ok((public.super_set_payment_settings('{"swift_bank_details": {"bank_name": "Escrow Bank", "swift_code": "escbkenx", "account_number": "0123 4567 8901", "account_name": "SokoGlobal Escrow Ltd"},
  "crypto_deposit_wallets": {"usdt_trc20": "TXYZabcdefghijkmnopqrstuvwxyz12345", "usdc_polygon": "0x00000000000000000000000000000000000000a1"}}', '10.0.0.2', 'test')).swift_bank_details ->> 'swift_code' = 'ESCBKENX',
  'super admin saves bank details (SWIFT upper-cased) and wallets');
select pg_temp.ok(exists (select 1 from public.admin_audit_logs where action = 'platform.payments' and ip = '10.0.0.2'), 'payment settings change is audited');

-- ── Online gateways (card_payments) ──
select pg_temp.as_user('e2822222-2222-4222-8222-222222222222');
select (public.create_trial_order('f2800000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select (public.create_trial_order('f2800000-0000-4000-8000-0000000000aa', 1)).id as o2 \gset
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.begin_gateway_payment('stripe', 'order', %L, 'e2822222-2222-4222-8222-222222222222', 'USD', 1)$q$, :'o1'), 'Unknown payment provider');
select pg_temp.fails(format($q$select public.begin_gateway_payment('dpo', 'pool', %L, 'e2822222-2222-4222-8222-222222222222', 'USD', 1)$q$, :'o1'), 'orders and cart');
select reference as dpo_ref, amount_minor as dpo_minor, provider as dpo_provider from public.begin_gateway_payment('dpo', 'order', :'o1', 'e2822222-2222-4222-8222-222222222222', 'USD', 1) \gset
select pg_temp.ok(:'dpo_provider' = 'dpo' and :dpo_minor = 58140, 'DPO charge is the fee-inclusive order total');
select pg_temp.ok(public.apply_card_payment(:'dpo_ref', 'dpo-tx-1', 58140, 'USD') = 'order_funded', 'verified DPO charge funds escrow');
select pg_temp.ok((select payment_provider = 'dpo' and payment_method = 'dpo_pay' and escrow_status::text = 'funded' from public.orders where id = :'o1'), 'order records DPO Pay');
select pg_temp.fails(format($q$select public.begin_gateway_payment('airtel_money', 'order', %L, 'e2822222-2222-4222-8222-222222222222', 'KES', 129.5)$q$, :'o2'), 'Airtel Money number');
select amount_minor as air_minor, gateway_token as air_token, phone as air_phone from public.begin_gateway_payment('airtel_money', 'order', :'o2', 'e2822222-2222-4222-8222-222222222222', 'KES', 129.5, '254733123456') \gset
select pg_temp.ok(:air_minor % 100 = 0 and :air_minor >= ceil(58140 * 129.5 * 1.01) and :'air_token' ~ '^SG[0-9A-F]{18}$', 'Airtel charge rounds up to whole shillings and gets its own transaction id');
select pg_temp.fails(format($q$select public.begin_gateway_payment('airtel_money', 'order', %L, 'e2822222-2222-4222-8222-222222222222', 'KES', 129.5, '254733123456')$q$, :'o2'), 'already sent');
update public.platform_settings set enable_paypal = false where id;
select pg_temp.fails(format($q$select public.begin_gateway_payment('paypal', 'order', %L, 'e2822222-2222-4222-8222-222222222222', 'USD', 1)$q$, :'o2'), 'PayPal is turned off');
update public.platform_settings set enable_paypal = true where id;
select pg_temp.as_user('e2822222-2222-4222-8222-222222222222');
set role authenticated;
select pg_temp.fails(format($q$select public.begin_gateway_payment('dpo', 'order', %L, auth.uid(), 'USD', 1)$q$, :'o2'), 'permission denied');
select pg_temp.fails(format($q$select public.approve_manual_payment(gen_random_uuid(), 1, 'x', auth.uid())$q$), 'permission denied');
reset role;

-- ── SWIFT wire ──
select (public.create_trial_order('f2800000-0000-4000-8000-0000000000aa', 1)).id as o3 \gset
select pg_temp.fails(format($q$select public.begin_manual_payment(%L, 'crypto_usdt', 'trc20')$q$, :'o3'), 'Crypto payments are not available');
select (public.begin_manual_payment(:'o3', 'swift_wire')).id as w1 \gset
select pg_temp.ok((select reference ~ '^SGW-[0-9A-F]{10}$' and usd_cents = 58140 and fee_cents = 0 and pay_to ->> 'bank_name' = 'Escrow Bank' and status = 'awaiting'
                     from public.manual_payments where id = :'w1'), 'wire request: unique reference, order total, bank details snapshot');
select pg_temp.ok((public.begin_manual_payment(:'o3', 'swift_wire')).id = :'w1', 'asking again returns the same open request');
select pg_temp.fails(format($q$select public.submit_manual_payment(%L)$q$, :'w1'), 'transfer confirmation');
select pg_temp.fails(format($q$select public.submit_manual_payment(%L, null, %L)$q$, :'w1', 'e2822222-2222-4222-8222-222222222222/' || :'w1' || '/11111111-1111-4111-8111-111111111111.pdf'), 'Upload the receipt again');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('payment-proofs', 'e2822222-2222-4222-8222-222222222222/' || :'w1' || '/11111111-1111-4111-8111-111111111111.pdf', 'e2822222-2222-4222-8222-222222222222', '{"size": 2048}');
select pg_temp.ok((public.submit_manual_payment(:'w1', null, 'e2822222-2222-4222-8222-222222222222/' || :'w1' || '/11111111-1111-4111-8111-111111111111.pdf')).status = 'submitted', 'buyer submits the bank receipt');
select pg_temp.fails(format($q$select public.begin_manual_payment(%L, 'swift_wire')$q$, :'o3'), 'being verified');
set role authenticated;
select pg_temp.as_user('e2833333-3333-4333-8333-333333333333');
select pg_temp.ok((select count(*) from public.manual_payments) = 0, 'other buyers cannot see the transfer');
select pg_temp.fails($q$update public.manual_payments set status = 'approved'$q$, 'permission denied');
reset role;
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.approve_manual_payment(%L, 58140, 'ok', 'e2822222-2222-4222-8222-222222222222')$q$, :'w1'), 'Super admin');
select pg_temp.fails(format($q$select public.approve_manual_payment(%L, 58000, 'short', 'e2844444-4444-4444-8444-444444444444')$q$, :'w1'), 'Received \$580.00 but \$581.40');
select pg_temp.ok((public.approve_manual_payment(:'w1', 58140, 'Credited 23 Oct', 'e2844444-4444-4444-8444-444444444444', '10.0.0.3', 'test')).escrow_status::text = 'funded', 'super admin approval funds escrow');
select pg_temp.ok((select payment_method = 'swift_wire' and payment_ref like 'SGW-%' and (payment_metadata ->> 'received_cents')::int = 58140 from public.orders where id = :'o3'), 'order records the wire and how it was verified');
select pg_temp.ok((select status = 'approved' and reviewed_by = 'e2844444-4444-4444-8444-444444444444' from public.manual_payments where id = :'w1'), 'transfer is approved');
select pg_temp.ok(exists (select 1 from public.admin_audit_logs where action = 'escrow.manual_payment_approved' and actor_id = 'e2844444-4444-4444-8444-444444444444' and target_id = :'o3'), 'approval audited with the admin');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'order.funded' and payload ->> 'order_id' = :'o3'), 'buyer told payment received');

-- ── Crypto ──
select pg_temp.as_user('e2844444-4444-4444-8444-444444444444');
select public.super_set_payment_settings('{"enable_crypto": true}');
select pg_temp.as_user('e2822222-2222-4222-8222-222222222222');
select (public.create_trial_order('f2800000-0000-4000-8000-0000000000aa', 1)).id as o4 \gset
select pg_temp.fails(format($q$select public.begin_manual_payment(%L, 'crypto_usdt', 'erc20')$q$, :'o4'), 'not available');
select pg_temp.fails(format($q$select public.begin_manual_payment(%L, 'crypto_usdc', 'trc20')$q$, :'o4'), 'supported network');
select (public.begin_manual_payment(:'o4', 'crypto_usdt', 'trc20')).id as c1 \gset
select pg_temp.ok((select fee_cents = 582 and charge_cents = 58722 and reference like 'SGC-%' and pay_to ->> 'address' like 'T%' from public.manual_payments where id = :'c1'),
                  'crypto adds the 1% handling fee (rounded up) and shows the TRC-20 address');
select pg_temp.fails(format($q$select public.submit_manual_payment(%L, '0x1234')$q$, :'c1'), 'TRON transaction hash');
select pg_temp.ok((public.submit_manual_payment(:'c1', upper(repeat('ab', 32)))).tx_hash = repeat('ab', 32), 'hash stored in lower case');
select (public.create_trial_order('f2800000-0000-4000-8000-0000000000aa', 1)).id as o5 \gset
select (public.begin_manual_payment(:'o5', 'crypto_usdt', 'trc20')).id as c2 \gset
select pg_temp.fails(format($q$select public.submit_manual_payment(%L, %L)$q$, :'c2', repeat('ab', 32)), 'already submitted');
select pg_temp.as_user('');
select (public.reject_manual_payment(:'c1', 'Nothing arrived at the deposit address', 'e2844444-4444-4444-8444-444444444444')).status as rejected \gset
select pg_temp.ok(:'rejected' = 'rejected', 'super admin rejects with a note');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'payment.manual_rejected' and payload ->> 'order_id' = :'o4'), 'buyer is told why');
select pg_temp.ok((select escrow_status::text = 'pending_payment' from public.orders where id = :'o4'), 'order still awaits payment');
select pg_temp.as_user('e2822222-2222-4222-8222-222222222222');
select pg_temp.ok((public.begin_manual_payment(:'o4', 'crypto_usdc', 'polygon')).status = 'awaiting', 'buyer can start again after a rejection');
select pg_temp.ok((public.cancel_manual_payment((select id from public.manual_payments where order_id = :'o4' and status = 'awaiting'))).status = 'cancelled', 'buyer cancels an unsent transfer');

-- ── Unpaid-order expiry waits for transfers ──
update public.orders set created_at = now() - interval '3 days' where id in (:'o5', :'o4');
select pg_temp.as_user('');
select public.expire_stale_unpaid_orders();
select pg_temp.ok((select escrow_status::text = 'pending_payment' from public.orders where id = :'o5'), 'order with a crypto transfer in progress is not expired');
select pg_temp.ok((select escrow_status::text = 'cancelled' from public.orders where id = :'o4'), 'order without one expires as before');

-- ── Revenue ──
select pg_temp.as_user('e2844444-4444-4444-8444-444444444444');
select pg_temp.ok((public.super_platform_revenue() ? 'crypto_fees_cents') and (public.super_platform_revenue() ->> 'manual_payments_pending')::int >= 0, 'revenue includes crypto fees and the review queue');
select 'ALL 028 CHECKS PASSED' as result;
