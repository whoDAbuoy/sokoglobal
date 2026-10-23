-- Migration 026: pricing defaults and super-admin edits, escrow fee in order totals (full + milestone),
-- logistics markup at approval, FX spread on card/M-Pesa charges, Gold Supplier purchase → commission
-- and badge, RFQ add-ons (featured ordering, white-glove ticket), instant early payout, revenue summary.
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
 ('e2611111-1111-4111-8111-111111111111', 's26@x.test',  '{"role":"supplier","full_name":"Sup 26","company_name":"Sup 26 Co","country_code":"CN"}'),
 ('e2622222-2222-4222-8222-222222222222', 'b26@x.test',  '{"role":"importer","full_name":"Buyer 26","company_name":"Buyer 26 Co","country_code":"KE"}'),
 ('e2633333-3333-4333-8333-333333333333', 'a26@x.test',  '{"role":"importer","full_name":"Ops 26","company_name":"SokoGlobal","country_code":"KE"}'),
 ('e2644444-4444-4444-8444-444444444444', 'sa26@x.test', '{"role":"importer","full_name":"Finance 26","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e26%';
update public.profiles set role = 'admin' where id = 'e2633333-3333-4333-8333-333333333333';
update public.profiles set role = 'super_admin' where id = 'e2644444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values ('f2600000-0000-4000-8000-000000000001', 'money-26', 'Money 26');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f2600000-0000-4000-8000-0000000000aa', 'e2611111-1111-4111-8111-111111111111', 'general', 'f2600000-0000-4000-8000-000000000001', 'Money 26 widget', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── Pricing defaults and super-admin edits ──
select pg_temp.ok((select supplier_gold_monthly_price = 49 and supplier_gold_commission_rate = 0.03 and default_supplier_commission_rate = 0.05
                          and featured_rfq_price = 15 and white_glove_sourcing_fee = 25 and escrow_fee_percent = 0.02 and fx_spread_percent = 0.01
                          and early_payout_discount_fee = 0.03 and logistics_markup_percent = 0.08
                     from public.platform_settings where id), 'pricing defaults are loaded');
set role anon;
select pg_temp.ok((select featured_rfq_price from public.platform_settings) = 15, 'prices are public');
reset role;
select pg_temp.as_user('e2633333-3333-4333-8333-333333333333');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"featured_rfq_price": 20}')$q$, 'Super admin');
select pg_temp.as_user('e2644444-4444-4444-8444-444444444444');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"supplier_gold_commission_rate": 0.06}')$q$, 'Gold commission');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"escrow_fee_percent": 0.5}')$q$, 'Escrow fee');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"featured_rfq_price": 0.5}')$q$, 'between \$1.00');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"featured_rfq_price": "20"}')$q$, 'must be a number');
select pg_temp.fails($q$select public.super_set_platform_pricing('{"pause_checkout": 1}')$q$, 'Unknown pricing field');
select pg_temp.ok((public.super_set_platform_pricing('{"featured_rfq_price": 20, "fx_spread_percent": 0.015}', '10.0.0.1', 'test')).featured_rfq_price = 20, 'super admin changes a price');
select pg_temp.ok((select detail -> 'to' ->> 'fx_spread_percent' = '0.0150' and actor_id = 'e2644444-4444-4444-8444-444444444444' and ip = '10.0.0.1'
                     from public.admin_audit_logs where action = 'platform.pricing' order by id desc limit 1), 'pricing change is audited with the actor and IP');
select public.super_set_platform_pricing('{"featured_rfq_price": 15, "fx_spread_percent": 0.01}');
set role authenticated;
select pg_temp.fails($q$update public.platform_settings set escrow_fee_percent = 0 where id$q$, 'permission denied');
reset role;

-- ── Escrow fee in the order total ──
select pg_temp.as_user('e2622222-2222-4222-8222-222222222222');
select (public.create_trial_order('f2600000-0000-4000-8000-0000000000aa', 1)).id as o1 \gset
select pg_temp.ok((select escrow_fee_cents = 1140 and escrow_fee_rate = 0.02 and total_cents = 58140 and commission_rate = 0.05
                     from public.orders where id = :'o1'), '2% escrow fee on goods + freight + customs is part of the total; standard commission snapshotted');
select (public.create_trial_order('f2600000-0000-4000-8000-0000000000aa', 2)).id as o2 \gset
select pg_temp.ok((public.set_order_payment_structure(:'o2', 'milestone_30_70')).deposit_amount = 34884, 'milestone deposit is 30% of the fee-inclusive total');
select pg_temp.ok((select remaining_balance = 116280 - 34884 from public.orders where id = :'o2'), 'balance covers the rest of the fee-inclusive total');
update public.orders set goods_cents = 100000 where id = :'o1';
select pg_temp.ok((select escrow_fee_cents = 2140 and total_cents = 109140 from public.orders where id = :'o1'), 'fee follows a price edit while unpaid');
update public.orders set goods_cents = 50000 where id = :'o1';

-- ── FX spread on charges ──
select pg_temp.as_user('');
select reference as kes_ref, amount_minor as kes_minor, fx_margin_cents as kes_margin, usd_rate as kes_rate from public.begin_card_payment('order', :'o1', 'e2622222-2222-4222-8222-222222222222', 'KES', 130) \gset
select pg_temp.ok(:kes_minor = ceil(58140 * 130 * 1.01) and :kes_margin = 581 and :kes_rate = 130, 'KES card charge carries the 1% spread; base rate is kept for partial refunds');
select reference as usd_ref, amount_minor as usd_minor, fx_margin_cents as usd_margin from public.begin_card_payment('order', :'o1', 'e2622222-2222-4222-8222-222222222222', 'USD', 1) \gset
select pg_temp.ok(:usd_minor = 58140 and :usd_margin = 0, 'USD card charges have no spread');
select pg_temp.ok(public.apply_card_payment(:'usd_ref', 'tx-26-1', :usd_minor, 'USD') = 'order_funded', 'the fee-inclusive total funds the order');
select pg_temp.ok((select escrow_fee_cents = 1140 from public.orders where id = :'o1'), 'fee is fixed once paid');
select amount_kes as mp_kes, fx_margin_cents as mp_margin from public.begin_mpesa_payment(:'o2', 'e2622222-2222-4222-8222-222222222222', '254712345678', 130, 300000) \gset
select pg_temp.ok(:mp_kes = ceil(34884 * 130 * 1.01 / 100.0) and :mp_margin = 349, 'M-Pesa deposit prompt includes the spread');

-- ── Logistics markup at listing approval ──
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f2600000-0000-4000-8000-0000000000bb', 'e2611111-1111-4111-8111-111111111111', 'general', 'f2600000-0000-4000-8000-000000000001', 'Money 26 gadget', 'CN', 500, 100, 50000, 0, 0, 'pending_review');
select pg_temp.as_user('e2633333-3333-4333-8333-333333333333');
select pg_temp.ok((select trial_freight_cents = 10800 and freight_markup_percent = 0.08 from public.admin_approve_product('f2600000-0000-4000-8000-0000000000bb', 10000, 2000)),
                  'approved freight = carrier cost + 8% markup');
select pg_temp.as_user('e2622222-2222-4222-8222-222222222222');
select pg_temp.ok((select logistics_markup_cents = 800 and escrow_fee_cents = 1256 from public.create_trial_order('f2600000-0000-4000-8000-0000000000bb', 1)),
                  'order records the markup inside its freight');

-- ── Gold Supplier ──
select pg_temp.as_user('');
select pg_temp.fails($q$select public.begin_card_purchase('subscription', 'e2622222-2222-4222-8222-222222222222', null, null, 'USD', 1)$q$, 'supplier accounts');
select reference as sub_ref, amount_minor as sub_minor from public.begin_card_purchase('subscription', 'e2611111-1111-4111-8111-111111111111', null, null, 'USD', 1) \gset
select pg_temp.ok(:'sub_ref' like 'sub.%' and :sub_minor = 4900, 'Gold month is priced from platform_settings');
select pg_temp.ok(not public.is_gold_supplier('e2611111-1111-4111-8111-111111111111'), 'not Gold before the charge settles');
select pg_temp.ok(public.apply_card_payment(:'sub_ref', 'tx-26-sub', 4900, 'USD') = 'subscription_activated', 'verified charge activates Gold');
select pg_temp.ok(public.is_gold_supplier('e2611111-1111-4111-8111-111111111111'), 'supplier is Gold');
select reference as sub2 from public.begin_card_purchase('subscription', 'e2611111-1111-4111-8111-111111111111', null, null, 'USD', 1) \gset
select pg_temp.ok(public.apply_card_payment(:'sub2', 'tx-26-sub2', 4900, 'USD') = 'subscription_activated', 'second month');
select pg_temp.ok((select current_period_end > now() + interval '58 days' from public.subscriptions where user_id = 'e2611111-1111-4111-8111-111111111111'), 'paying again extends the period');
set role anon;
select pg_temp.ok((select count(*) from public.gold_supplier_ids(array['e2611111-1111-4111-8111-111111111111', 'e2622222-2222-4222-8222-222222222222']::uuid[])) = 1, 'badge lookup is public');
reset role;
set role authenticated;
select pg_temp.as_user('e2622222-2222-4222-8222-222222222222');
select pg_temp.ok((select count(*) from public.subscriptions) = 0, 'other users cannot read a subscription');
select pg_temp.fails($q$insert into public.subscriptions (user_id, plan_type, current_period_end) values (auth.uid(), 'gold_supplier', now() + interval '1 year')$q$, 'permission denied');
select pg_temp.as_user('e2611111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.subscriptions) = 1, 'supplier reads their own subscription');
reset role;
select pg_temp.as_user('e2622222-2222-4222-8222-222222222222');
select (public.create_trial_order('f2600000-0000-4000-8000-0000000000aa', 1)).id as o3 \gset
select pg_temp.ok((select commission_rate = 0.03 from public.orders where id = :'o3'), 'orders placed while Gold is active get the Gold commission');

-- ── RFQ add-ons ──
select (public.submit_rfq('Featured widgets', 'Need widgets fast, featured please', 500, 'Nairobi', null, 'f2600000-0000-4000-8000-000000000001')).id as rfq_f \gset
select (public.submit_rfq('Plain widgets', 'Need widgets, no rush at all', 500, 'Mombasa', null, 'f2600000-0000-4000-8000-000000000001')).id as rfq_p \gset
set role authenticated;
select pg_temp.fails(format($q$update public.rfqs set is_featured = true where id = %L$q$, :'rfq_p'), 'permission denied');
reset role;
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.begin_card_purchase('rfq_addon', 'e2611111-1111-4111-8111-111111111111', %L, array['featured'], 'USD', 1)$q$, :'rfq_f'), 'Request not found');
select pg_temp.fails(format($q$select public.begin_card_purchase('rfq_addon', 'e2622222-2222-4222-8222-222222222222', %L, array['banner'], 'USD', 1)$q$, :'rfq_f'), 'Choose Featured');
select reference as add_ref, amount_minor as add_minor from public.begin_card_purchase('rfq_addon', 'e2622222-2222-4222-8222-222222222222', :'rfq_f', array['white_glove', 'featured', 'featured'], 'USD', 1) \gset
select pg_temp.ok(:add_minor = 4000, 'featured $15 + white-glove $25');
select pg_temp.ok(public.apply_card_payment(:'add_ref', 'tx-26-add', 4000, 'USD') = 'rfq_addon_applied', 'add-on payment settles');
select pg_temp.ok((select is_featured and needs_white_glove and featured_at is not null from public.rfqs where id = :'rfq_f'), 'request is featured and flagged for white-glove');
select pg_temp.ok((select count(*) from public.support_tickets t join public.support_messages m on m.ticket_id = t.id
                    where t.user_id = 'e2622222-2222-4222-8222-222222222222' and t.subject like 'White-glove sourcing:%'
                      and m.sender_id = t.user_id and m.sender_role = 'customer' and m.body like '%' || :'rfq_f' || '%') = 1, 'white-glove opens a support ticket for the ops team');
select pg_temp.fails(format($q$select public.begin_card_purchase('rfq_addon', 'e2622222-2222-4222-8222-222222222222', %L, array['featured'], 'USD', 1)$q$, :'rfq_f'), 'already featured');
select pg_temp.as_user('e2611111-1111-4111-8111-111111111111');
select pg_temp.ok((select id = :'rfq_f' and is_featured from public.supplier_rfq_feed() limit 1), 'featured request is first in the supplier feed (even though it is older)');

-- ── Instant early payout ──
select pg_temp.as_user('');
select reference as r3, amount_minor as m3 from public.begin_card_payment('order', :'o3', 'e2622222-2222-4222-8222-222222222222', 'USD', 1) \gset
select pg_temp.ok(public.apply_card_payment(:'r3', 'tx-26-3', :m3, 'USD') = 'order_funded', 'Gold order funded');
select pg_temp.as_user('e2611111-1111-4111-8111-111111111111');
select pg_temp.ok((select not (q ->> 'eligible')::boolean and q ->> 'reason' like '%dispatched%' from public.early_payout_quote(:'o3') q), 'not before dispatch');
select (public.supplier_save_shipment(:'o3', 'DHL Express', 'JD026000001', null, now() + interval '5 days', 'in_transit')).status as shipped \gset
select pg_temp.ok((select (q ->> 'reason') ~ 'KYC|payout account' from public.early_payout_quote(:'o3') q), 'needs supplier KYC and a verified payout account');
update public.profiles set kyc_verified = true where id = 'e2611111-1111-4111-8111-111111111111';
select pg_temp.as_user('e2633333-3333-4333-8333-333333333333');
insert into public.supplier_payout_accounts (supplier_id, method, country_code, currency, bank_code, beneficiary_name, verified, account_number_secret_id)
values ('e2611111-1111-4111-8111-111111111111', 'bank', 'KE', 'USD', '044', 'Sup 26 Co', true, vault.create_secret('0123456789'));
select pg_temp.as_user('e2622222-2222-4222-8222-222222222222');
select pg_temp.fails(format($q$select public.request_early_payout(%L)$q$, :'o3'), 'Order not found');
select pg_temp.fails(format($q$select public.early_payout_quote(%L)$q$, :'o3'), 'Order not found');
select pg_temp.as_user('e2611111-1111-4111-8111-111111111111');
select pg_temp.ok((select (q ->> 'eligible')::boolean and (q ->> 'commission_cents')::int = 1500 and (q ->> 'fee_cents')::int = 1500 and (q ->> 'net_cents')::int = 47000
                     from public.early_payout_quote(:'o3') q), 'quote: goods − 3% Gold commission − 3% early fee');
select pg_temp.ok((select not (q ->> 'eligible')::boolean from public.early_payout_quote(:'o2') q), 'unpaid milestone order is not eligible');
select pg_temp.ok((public.request_early_payout(:'o3') ->> 'requested_at') is not null, 'supplier requests the early payout');
select pg_temp.fails(format($q$select public.request_early_payout(%L)$q$, :'o3'), 'already requested');
select pg_temp.as_user('');
select pg_temp.fails(format($q$select public.begin_payout(%L, 0)$q$, :'o1'), 'not released');
select public.begin_payout(:'o3', 0) as claim \gset
select pg_temp.ok((:'claim'::jsonb ->> 'action') = 'transfer' and (:'claim'::jsonb ->> 'amount_cents')::int = 47000, 'payout worker sends the early payout');
select pg_temp.ok((select early and fee_cents = 3000 and early_payout_fee_cents = 1500 and gross_cents = 50000 from public.payouts where order_id = :'o3'), 'payout records commission + early fee');
select public.finish_payout((:'claim'::jsonb ->> 'payout_id')::uuid, true, 'flw-26', null);
select pg_temp.ok((select to_status::text = 'in_transit' and (metadata ->> 'early')::boolean from public.escrow_events
                    where order_id = :'o3' and event_type = 'payout_initiated'), 'payout event keeps the real escrow state (not "released")');
select pg_temp.ok(public.complete_payout(:'claim'::jsonb ->> 'reference', 'flw-26', true, 'done') = 'payout_succeeded', 'transfer completes');
select pg_temp.ok((select escrow_status::text = 'in_transit' from public.orders where id = :'o3'), 'buyer escrow state is unchanged by the early payout');

-- ── Revenue ──
select pg_temp.as_user('e2633333-3333-4333-8333-333333333333');
select pg_temp.fails($q$select public.super_platform_revenue()$q$, 'Super admin');
select pg_temp.as_user('e2644444-4444-4444-8444-444444444444');
select public.super_platform_revenue() as rev \gset
select pg_temp.ok((:'rev'::jsonb ->> 'subscriptions_cents')::int >= 9800 and (:'rev'::jsonb ->> 'rfq_featured_cents')::int >= 1500
                  and (:'rev'::jsonb ->> 'rfq_white_glove_cents')::int >= 2500 and (:'rev'::jsonb ->> 'escrow_fees_cents')::int >= 2280
                  and (:'rev'::jsonb ->> 'commission_cents')::int >= 1500 and (:'rev'::jsonb ->> 'early_payout_fees_cents')::int >= 1500
                  and (:'rev'::jsonb ->> 'early_payout_exposure_cents')::int >= 47000 and (:'rev'::jsonb ->> 'active_gold_suppliers')::int >= 1
                  and (:'rev'::jsonb ->> 'white_glove_open')::int >= 1, 'revenue summary covers every stream');

-- ── Lapsed Gold ──
update public.subscriptions set current_period_end = now() - interval '1 minute' where user_id = 'e2611111-1111-4111-8111-111111111111';
select pg_temp.ok(not public.is_gold_supplier('e2611111-1111-4111-8111-111111111111'), 'Gold ends with the paid period');
select pg_temp.ok(public.expire_lapsed_subscriptions() >= 1, 'lapsed subscriptions are marked');
select pg_temp.ok((select status = 'past_due' from public.subscriptions where user_id = 'e2611111-1111-4111-8111-111111111111'), 'status is past_due');
select 'ALL 026 CHECKS PASSED' as result;
