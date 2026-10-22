-- Migration 021 end to end: RFQ visibility and RLS, quote → order pricing, milestone
-- escrow over card and M-Pesa (deposit → dispatch → balance → delivery → release),
-- disputes and refund caps, unchanged full/cart payments, restock reminders, RFQ
-- expiry and exchange rates. Run with `npm run test:db` (scripts/db-test.mjs).
-- Each check raises NOTICE 'pass: …'; the first failure aborts the transaction.
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
 ('11111111-1111-4111-8111-111111111111', 'sup@x.test',  '{"role":"supplier","full_name":"Sup One","company_name":"Sup Co","country_code":"US"}'),
 ('22222222-2222-4222-8222-222222222222', 'imp@x.test',  '{"role":"importer","full_name":"Imp One","company_name":"Imp Co","country_code":"KE"}'),
 ('33333333-3333-4333-8333-333333333333', 'sup2@x.test', '{"role":"supplier","full_name":"Sup Two","company_name":"Food Co","country_code":"US"}'),
 ('44444444-4444-4444-8444-444444444444', 'imp2@x.test', '{"role":"importer","full_name":"Imp Two","company_name":"Imp Two Co","country_code":"UG"}');
update public.profiles set kyc_status = 'approved' where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');

insert into public.categories (id, slug, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'apparel-x', 'Apparel X'), ('aaaaaaaa-0000-4000-8000-000000000003', 'food-x', 'Food X');
insert into public.categories (id, parent_id, slug, name) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'shirts-x', 'Shirts X');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'clothing', 'aaaaaaaa-0000-4000-8000-000000000002', 'Plain cotton tee', 'US', 500, 100, 50000, 5000, 2000, 'live'),
       ('bbbbbbbb-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'general', 'aaaaaaaa-0000-4000-8000-000000000003', 'Dried mango', 'US', 300, 100, 50000, 5000, 2000, 'live');

-- ── RFQ ──
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select pg_temp.fails($q$select public.submit_rfq('Shirts', 'Need many shirts please', 10, 'Kampala')$q$, 'KYC');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.submit_rfq('Bulk cotton shirts', 'Need 1000 plain cotton tees, assorted sizes', 1000, 'Nairobi, Kenya', 400, 'aaaaaaaa-0000-4000-8000-000000000001', null, 'pieces', 14)).id as rfq \gset
select pg_temp.ok((select status from public.rfqs where id = :'rfq') = 'open', 'rfq starts open');

set role authenticated;
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.rfqs) = 1, 'supplier with a listing in a child category sees the RFQ');
select pg_temp.ok((select buyer_country from public.supplier_rfq_feed() limit 1) = 'KE', 'supplier feed shows buyer country');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select pg_temp.ok((select count(*) from public.rfqs) = 0, 'supplier in another category does not see it');
select pg_temp.fails(format($q$select public.submit_rfq_quote(%L, 'bbbbbbbb-0000-4000-8000-000000000002', 300, 10, now() + interval '7 days')$q$, :'rfq'), 'not in the requested category');
select pg_temp.fails($q$insert into public.rfqs (buyer_id, title, description, quantity, delivery_location) values (auth.uid(), 'xyz', 'xxxxxxxxxxxx', 1, 'xx')$q$, 'permission denied');
reset role;

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.fails(format($q$select public.submit_rfq_quote(%L, 'bbbbbbbb-0000-4000-8000-000000000001', 420, 500, now() + interval '7 days', null, '[{"min_qty":1000,"unit_price_kes":400}]', array['credit_30_days'])$q$, :'rfq'), 'Trade credit');
select pg_temp.fails(format($q$select public.submit_rfq_quote(%L, 'bbbbbbbb-0000-4000-8000-000000000001', 420, 500, now() + interval '7 days', null, '[{"min_qty":"x","unit_price_kes":400}]')$q$, :'rfq'), 'check constraint');
select (public.submit_rfq_quote(:'rfq', 'bbbbbbbb-0000-4000-8000-000000000001', 420, 500, now() + interval '7 days', 'Delivered Nairobi', '[{"min_qty":1000,"unit_price_kes":400}]', array['full','milestone_30_70'], 21)).id as quote \gset
select pg_temp.ok((select status from public.rfqs where id = :'rfq') = 'quoted', 'rfq becomes quoted');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'rfq.quote_received' and user_id = '22222222-2222-4222-8222-222222222222'), 'buyer notified of quote');

set role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select pg_temp.ok((select count(*) from public.rfq_quotes) = 0, 'other buyers cannot see the quote');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.ok((select count(*) from public.rfq_quotes) = 1, 'buyer sees quotes on own RFQ');
reset role;

select pg_temp.fails(format($q$select public.accept_rfq_quote(%L, 'credit_30_days')$q$, :'quote'), 'Trade credit');
select (public.accept_rfq_quote(:'quote', 'milestone_30_70')).id as ord \gset
select pg_temp.ok((select quantity = 1000 and goods_cents = round(400000 * 100 / 129.25) and payment_structure = 'milestone_30_70'
                          and deposit_amount = 92844 and remaining_balance = 309478 - 92844 and order_type = 'standard' and fx_rate_to_kes = 129.25
                     from public.orders where id = :'ord'), 'order priced from the tier, converted at the USD rate, split 30/70');
select pg_temp.ok((select status = 'accepted' and order_id = :'ord' and accepted_quote_id = :'quote' from public.rfqs where id = :'rfq'), 'rfq accepted and linked');
select pg_temp.fails(format($q$select public.set_order_payment_structure(%L, 'full')$q$, :'ord'), 'fixed by the accepted quote');
select pg_temp.fails(format($q$select public.accept_rfq_quote(%L, 'full')$q$, :'quote'), 'already accepted');

-- ── Deposit by card ──
select pg_temp.as_user('');
select reference as dep_ref, amount_minor as dep_minor, usd_cents as dep_usd, leg as dep_leg from public.begin_card_payment('order', :'ord', '22222222-2222-4222-8222-222222222222', 'KES', 129.25) \gset
select pg_temp.ok(:dep_usd = 92844 and :'dep_leg' = 'deposit' and :dep_minor = ceil(92844 * 129.25), 'card attempt charges the 30% deposit');
select pg_temp.ok(public.apply_card_payment(:'dep_ref', 'tx-dep', :dep_minor, 'KES') = 'deposit_funded', 'deposit settles');
select pg_temp.ok((select escrow_status::text = 'deposit_paid' and deposit_paid_at is not null and funded_at is not null and final_paid_at is null from public.orders where id = :'ord'), 'order is deposit_paid');
select pg_temp.ok(public.apply_card_payment(:'dep_ref', 'tx-dep', :dep_minor, 'KES') = 'already_processed', 'apply is idempotent');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'order.deposit_paid'), 'buyer told deposit received');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'supplier.order_deposit'), 'supplier told to prepare');
select pg_temp.fails(format($q$select public.begin_card_payment('order', %L, '22222222-2222-4222-8222-222222222222', 'KES', 129.25)$q$, :'ord'), 'once the supplier dispatches');

-- ── Supplier sees it and ships ──
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.get_supplier_grouped_catalog() g, jsonb_array_elements(g.orders) o where o ->> 'order_id' = :'ord') = 1, 'deposit-paid order is in the to-ship list');
select pg_temp.as_user('33333333-3333-4333-8333-333333333333');
select pg_temp.fails(format($q$select public.supplier_save_shipment(%L, 'DHL Express', 'JD014600006', null, now() + interval '5 days', 'in_transit')$q$, :'ord'), 'Order not found');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.fails(format($q$select public.supplier_save_shipment(%L, 'DHL Express', 'JD014600006', null, now() - interval '1 day', 'in_transit')$q$, :'ord'), 'future');
select pg_temp.ok((public.supplier_save_shipment(:'ord', 'DHL Express', 'JD014600006', null, now() + interval '5 days', 'in_transit')).status = 'in_transit', 'supplier dispatches');
select pg_temp.ok((select current_status::text = 'in_transit' and escrow_status::text = 'deposit_paid' and tracking_number = 'JD014600006' and carrier = 'DHL Express' and eta_timestamp is not null from public.orders where id = :'ord'), 'order tracking follows; escrow waits for the balance');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'order.balance_due' and payload ->> 'tracking_number' = 'JD014600006'), 'balance-due alert queued with waybill');
select pg_temp.fails(format($q$select public.supplier_save_shipment(%L, 'DHL Express', 'JD014600006', null, null, 'label_created')$q$, :'ord'), 'cannot move back');

-- ── Balance: over the M-Pesa limit, then by card ──
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.begin_mpesa_payment(%L, '22222222-2222-4222-8222-222222222222', '254712345678', 129.25, 250000)$q$, :'ord'), 'above the M-Pesa limit');
select reference as bal_ref, amount_minor as bal_minor, usd_cents as bal_usd, leg as bal_leg from public.begin_card_payment('order', :'ord', '22222222-2222-4222-8222-222222222222', 'KES', 129.25) \gset
select pg_temp.ok(:bal_usd = 309478 - 92844 and :'bal_leg' = 'balance', 'second attempt charges the 70% balance');
select pg_temp.ok(public.apply_card_payment(:'bal_ref', 'tx-bal', :bal_minor, 'KES') = 'balance_funded', 'balance settles');
select pg_temp.ok((select escrow_status::text = 'in_transit' and final_paid_at is not null from public.orders where id = :'ord'), 'order joins the normal escrow flow where the shipment is');
select pg_temp.ok((select public.order_paid_cents(o) = o.total_cents and public.order_amount_due_cents(o) = 0 from public.orders o where id = :'ord'), 'fully collected, nothing due');
select pg_temp.ok(exists (select 1 from public.notification_queue where template_key = 'supplier.order_balance_paid'), 'supplier told balance paid');

select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select (public.supplier_save_shipment(:'ord', 'DHL Express', 'JD014600006', null, null, 'delivered')).status as delivered_status \gset
select pg_temp.ok((select escrow_status::text = 'delivered_pending_verification' and delivered_at is not null from public.orders where id = :'ord'), 'delivered → buyer verifies');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.ok((public.confirm_delivery(:'ord')).escrow_status::text = 'released', 'buyer releases escrow');

-- ── RLS on shipments ──
set role authenticated;
select pg_temp.as_user('44444444-4444-4444-8444-444444444444');
select pg_temp.ok((select count(*) from public.shipments) = 0, 'other buyers cannot read the shipment');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.ok((select count(*) from public.shipments) = 1, 'buyer reads own shipment');
select pg_temp.as_user('11111111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.shipments) = 1, 'supplier reads own shipment');
reset role;

-- ── Catalogue order: milestone by M-Pesa, then dispute ──
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.create_trial_order('bbbbbbbb-0000-4000-8000-000000000001', 1)).id as small \gset
select pg_temp.fails(format($q$select public.set_order_payment_structure(%L, 'milestone_30_70')$q$, :'small'), 'at least');
select (public.create_trial_order('bbbbbbbb-0000-4000-8000-000000000001', 2)).id as ord2 \gset
select pg_temp.ok((public.set_order_payment_structure(:'ord2', 'milestone_30_70')).deposit_amount = 34200, 'buyer switches a $1,140 order to milestone (deposit $342)');
select pg_temp.as_user('');
select id as mp, amount_kes as mp_kes, leg as mp_leg from public.begin_mpesa_payment(:'ord2', '22222222-2222-4222-8222-222222222222', '254712345678', 129.25, 250000) \gset
select pg_temp.ok(:mp_kes = ceil(34200 * 129.25 / 100.0) and :'mp_leg' = 'deposit', 'STK push is for the deposit in KES');
update public.mpesa_payments set status = 'pending', checkout_request_id = 'ws_CO_1' where id = :'mp';
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.fails(format($q$select public.set_order_payment_structure(%L, 'full')$q$, :'ord2'), 'still in progress');
select pg_temp.as_user('');
select pg_temp.ok(public.apply_mpesa_payment('ws_CO_1', 0, 'ok', 'RCPT1', :mp_kes) = 'deposit_funded', 'M-Pesa deposit settles');
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select pg_temp.ok((public.open_dispute(:'ord2', 'Supplier stopped responding')).escrow_status::text = 'disputed', 'a held deposit can be disputed');
select pg_temp.ok((select public.order_paid_cents(o) from public.orders o where id = :'ord2') = 34200, 'refund cap is the deposit only');

-- ── Unchanged paths: full order + cart ──
select (public.create_trial_order('bbbbbbbb-0000-4000-8000-000000000001', 1)).id as ord3 \gset
select (public.create_cart_checkout(array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], array[1])).id as grp \gset
select pg_temp.as_user('');
select reference as r3, amount_minor as m3, coalesce(leg, 'none') as l3 from public.begin_card_payment('order', :'ord3', '22222222-2222-4222-8222-222222222222', 'USD', 1) \gset
select pg_temp.ok(:m3 = 57000 and :'l3' = 'none', 'full orders still charge the total, no leg');
select pg_temp.ok(public.apply_card_payment(:'r3', 'tx3', :m3, 'USD') = 'order_funded', 'full order funds');
select reference as rg, amount_minor as mg from public.begin_card_payment('group', :'grp', '22222222-2222-4222-8222-222222222222', 'USD', 1) \gset
select pg_temp.ok(public.apply_card_payment(:'rg', 'txg', :mg, 'USD') = 'group_funded', 'cart checkout funds');
select pg_temp.fails(format($q$update public.orders set payment_structure = 'milestone_30_70' where checkout_group_id = %L$q$, :'grp'), 'orders_cart_pays_full|locked');

-- ── Restock reminders ──
update public.orders set released_at = now() - interval '31 days', created_at = now() - interval '40 days' where id = :'ord';
select pg_temp.ok(public.queue_restock_reminders() = 0, 'a newer order of the same listing counts as a reorder');
update public.orders set created_at = now() - interval '45 days' where id <> :'ord' and buyer_id = '22222222-2222-4222-8222-222222222222';
select pg_temp.ok(public.queue_restock_reminders() = 1, '30-day reminder queued');
select pg_temp.ok(public.queue_restock_reminders() = 0, 'never twice');

-- ── RFQ expiry ──
select pg_temp.as_user('22222222-2222-4222-8222-222222222222');
select (public.submit_rfq('Old request', 'Something we no longer need', 5, 'Mombasa')).id as old \gset
update public.rfqs set created_at = now() - interval '20 days', expires_at = now() - interval '1 day' where id = :'old';
select pg_temp.ok(public.expire_stale_rfqs() = 1, 'stale request expires');
select pg_temp.ok((select status from public.rfqs where id = :'old') = 'expired', 'status is expired');

-- ── Exchange rates ──
set role anon;
select pg_temp.ok((select count(*) from public.exchange_rates) = 5, 'anyone can read rates');
reset role;
select pg_temp.fails($q$select public.super_set_exchange_rate('USD', 130)$q$, 'Super admin');
select 'ALL SCENARIO CHECKS PASSED' as result;
