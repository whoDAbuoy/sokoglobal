-- Migration 033: integration outbox. Events are queued per target by the triggers; n8n copies never name the buyer;
-- profile views are buyers-only and once a day; the outbox, links and dispatcher RPCs are service-role only;
-- claim/finish lease and back off; a broken outbox never blocks an escrow change.
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
-- This file's events: its fixed ids (e33…/f3300000-…) or its " e33" titles. Not a bare 'e33': other files' random
-- uuids contain it about 1 time in 100, which made the counts below flaky.
create or replace function pg_temp.mine(p jsonb) returns boolean language sql immutable as $$
  select p::text ~ '(e33[0-9]{5}-|f3300000-| e33")'
$$;
create or replace function pg_temp.outbox(p_target text, p_type text) returns setof public.integration_outbox language sql as $$
  select * from public.integration_outbox where target = p_target and event_type = p_type and pg_temp.mine(payload) order by id
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e3311111-1111-4111-8111-111111111111', 's33@x.test', '{"role":"supplier","full_name":"Sup 33","company_name":"Sup 33 Co","country_code":"CN"}'),
 ('e3322222-2222-4222-8222-222222222222', 'b33@x.test', '{"role":"importer","full_name":"Buyer 33","company_name":"Buyer 33 Co","country_code":"KE"}'),
 ('e3333333-3333-4333-8333-333333333333', 't33@x.test', '{"role":"supplier","full_name":"Other Sup 33","company_name":"Other Sup 33 Co","country_code":"IN"}'),
 ('e3344444-4444-4444-8444-444444444444', 'x33@x.test', '{"role":"supplier","full_name":"Banned Sup 33","company_name":"Banned 33 Co","country_code":"CN"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e33%';
update public.profiles set phone_number = '+254700000033', sms_alerts = true where id = 'e3311111-1111-4111-8111-111111111111';
update public.profiles set is_banned = true where id = 'e3344444-4444-4444-8444-444444444444';
insert into public.categories (id, slug, name) values
 ('f3300000-0000-4000-8000-000000000001', 'outbox-33', 'Outbox 33'),
 ('f3300000-0000-4000-8000-000000000002', 'outbox-33-other', 'Outbox 33 other');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f3300000-0000-4000-8000-0000000000a1', 'e3311111-1111-4111-8111-111111111111', 'general', 'f3300000-0000-4000-8000-000000000001', 'Kettle e33', 'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f3300000-0000-4000-8000-0000000000a2', 'e3333333-3333-4333-8333-333333333333', 'general', 'f3300000-0000-4000-8000-000000000002', 'Lamp e33', 'IN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f3300000-0000-4000-8000-0000000000a3', 'e3344444-4444-4444-8444-444444444444', 'general', 'f3300000-0000-4000-8000-000000000001', 'Banned kettle e33', 'CN', 500, 100, 50000, 5000, 2000, 'live');

-- ── RFQs ──
set role authenticated;
select pg_temp.as_user('e3322222-2222-4222-8222-222222222222');
select (public.submit_rfq('Kettles e33', 'Need 500 electric kettles e33', 500, 'Nairobi', 900, 'f3300000-0000-4000-8000-000000000001')).id as rfq_cat \gset
select (public.submit_rfq('Listing kettles e33', 'From the listing page e33', 200, 'Mombasa', null, null, 'f3300000-0000-4000-8000-0000000000a1')).id as rfq_listing \gset
reset role;
select pg_temp.ok((select count(*) from pg_temp.outbox('n8n', 'rfq.created')) = 2, 'every new RFQ is queued for n8n');
select pg_temp.ok(not exists (select 1 from pg_temp.outbox('n8n', 'rfq.created') where payload ? 'buyer_id' or payload ? 'buyer_name' or payload ? 'buyer_company'),
  'n8n RFQ payloads carry the buyer''s country only, never who they are');
select pg_temp.ok((select payload ->> 'buyer_country' from pg_temp.outbox('n8n', 'rfq.created') limit 1) = 'KE', 'n8n RFQ payload has the buyer country');
select pg_temp.ok((select count(*) from pg_temp.outbox('twenty', 'rfq.created')) = 1, 'only the listing RFQ goes straight to the CRM');
select pg_temp.ok((select payload ->> 'supplier_id' = 'e3311111-1111-4111-8111-111111111111' and payload ->> 'buyer_company' = 'Buyer 33 Co'
                     from pg_temp.outbox('twenty', 'rfq.created')), 'CRM copy names the listing''s supplier and the buyer');
select pg_temp.ok((select array_agg(supplier_id order by supplier_id) from public.rfq_supplier_recipients(:'rfq_cat'))
                  = array['e3311111-1111-4111-8111-111111111111']::uuid[], 'recipients: category match only, banned supplier excluded');
select pg_temp.ok((select phone_number = '+254700000033' and sms_alerts and email = 's33@x.test' from public.rfq_supplier_recipients(:'rfq_cat')),
  'recipients carry the supplier''s own contact details and opt-ins');

-- ── Quotes ──
set role authenticated;
select pg_temp.as_user('e3311111-1111-4111-8111-111111111111');
select (public.submit_rfq_quote(:'rfq_cat', 'f3300000-0000-4000-8000-0000000000a1', 850, 100, now() + interval '7 days')).id as quote \gset
reset role;
select pg_temp.ok((select count(*) from pg_temp.outbox('twenty', 'rfq.quote_submitted')) = 1, 'a first quote is queued for the CRM');
update public.rfq_quotes set unit_price_kes = 800 where id = :'quote';
select pg_temp.ok((select count(*) from pg_temp.outbox('twenty', 'rfq.quote_submitted')) = 1, 'a revised quote is not queued again');

-- ── Escrow milestones ──
insert into public.orders (id, buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents) values
 ('f3300000-0000-4000-8000-0000000000c0', 'e3322222-2222-4222-8222-222222222222', 'f3300000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000);
select pg_temp.ok((select count(*) from public.integration_outbox where event_type = 'escrow.status_changed' and payload ->> 'order_id' = 'f3300000-0000-4000-8000-0000000000c0') = 0,
  'order creation (pending payment) is not a milestone');
-- Funding is guarded (verified payments only), so this order starts funded; the audit log records it.
insert into public.orders (id, buyer_id, product_id, order_type, quantity, goods_cents, freight_cents, customs_cents, escrow_status, funded_at) values
 ('f3300000-0000-4000-8000-0000000000c1', 'e3322222-2222-4222-8222-222222222222', 'f3300000-0000-4000-8000-0000000000a1', 'trial', 100, 50000, 5000, 2000, 'funded', now());
select pg_temp.ok((select payload ->> 'to_status' = 'funded' and payload ->> 'supplier_id' = 'e3311111-1111-4111-8111-111111111111'
                     from public.integration_outbox where event_type = 'escrow.status_changed' and payload ->> 'order_id' = 'f3300000-0000-4000-8000-0000000000c1'),
  'a funded order queues an escrow milestone for n8n');
update public.orders set escrow_status = 'in_transit' where id = 'f3300000-0000-4000-8000-0000000000c1';
select pg_temp.ok((select count(*) from public.integration_outbox where event_type = 'escrow.status_changed' and payload ->> 'order_id' = 'f3300000-0000-4000-8000-0000000000c1'
                      and payload ->> 'from_status' = 'funded' and payload ->> 'to_status' = 'in_transit') = 1,
  'each later transition is its own milestone');

-- A broken outbox never blocks the escrow change itself.
alter table public.integration_outbox add constraint integration_outbox_test_block check (false) not valid;
update public.orders set escrow_status = 'customs_cleared' where id = 'f3300000-0000-4000-8000-0000000000c1';
select pg_temp.ok((select escrow_status = 'customs_cleared' from public.orders where id = 'f3300000-0000-4000-8000-0000000000c1'),
  'escrow status still changes when queuing the event fails');
select pg_temp.ok((select count(*) from public.escrow_events where order_id = 'f3300000-0000-4000-8000-0000000000c1' and to_status = 'customs_cleared') = 1,
  'the escrow audit log is still written');
select pg_temp.ok((select count(*) from public.integration_outbox where event_type = 'escrow.status_changed' and payload ->> 'order_id' = 'f3300000-0000-4000-8000-0000000000c1') = 2,
  'the failed event is dropped, not half-written');
alter table public.integration_outbox drop constraint integration_outbox_test_block;

-- ── Inquiries ──
insert into public.chat_threads (id, product_id, buyer_id, supplier_id) values
 ('f3300000-0000-4000-8000-0000000000d1', 'f3300000-0000-4000-8000-0000000000a1', 'e3322222-2222-4222-8222-222222222222', 'e3311111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.integration_outbox where event_type = 'lead.inquiry_created' and payload ->> 'thread_id' = 'f3300000-0000-4000-8000-0000000000d1') = 2,
  'a product conversation is a lead for n8n and the CRM');
select pg_temp.ok((select not (payload ? 'buyer_name') and not (payload ? 'buyer_id') from public.integration_outbox
                    where target = 'n8n' and event_type = 'lead.inquiry_created' and payload ->> 'thread_id' = 'f3300000-0000-4000-8000-0000000000d1'),
  'n8n inquiry payload shows the buyer company (as the inbox does) but not the person');

-- ── Profile views ──
set role authenticated;
select pg_temp.as_user('e3322222-2222-4222-8222-222222222222');
select public.record_supplier_profile_view('e3311111-1111-4111-8111-111111111111');
select public.record_supplier_profile_view('e3311111-1111-4111-8111-111111111111');
select public.record_supplier_profile_view('e3344444-4444-4444-8444-444444444444');
select public.record_supplier_profile_view('e3322222-2222-4222-8222-222222222222');
select pg_temp.as_user('e3333333-3333-4333-8333-333333333333');
select public.record_supplier_profile_view('e3311111-1111-4111-8111-111111111111');
reset role;
select pg_temp.ok((select count(*) from pg_temp.outbox('twenty', 'supplier.profile_viewed')) = 1,
  'profile views: once per buyer per day; banned suppliers, own profile and supplier viewers are ignored');

-- ── Access ──
set role authenticated;
select pg_temp.as_user('e3311111-1111-4111-8111-111111111111');
select pg_temp.fails($q$select count(*) from public.integration_outbox$q$, 'permission denied');
select pg_temp.fails($q$select count(*) from public.crm_links$q$, 'permission denied');
select pg_temp.fails($q$select * from public.claim_integration_events('n8n', 10)$q$, 'permission denied');
select pg_temp.fails($q$select public.finish_integration_event(1, 'sent')$q$, 'permission denied');
select pg_temp.fails($q$select * from public.rfq_supplier_recipients('f3300000-0000-4000-8000-0000000000a1')$q$, 'permission denied');
select pg_temp.fails($q$select * from public.integration_contacts(array['e3322222-2222-4222-8222-222222222222']::uuid[])$q$, 'permission denied');
select pg_temp.fails($q$select public.enqueue_integration_event('n8n', 'rfq.created', '{}', 'forged:1')$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.fails($q$select public.record_supplier_profile_view('e3311111-1111-4111-8111-111111111111')$q$, 'permission denied');
select pg_temp.fails($q$select count(*) from public.integration_outbox$q$, 'permission denied');
reset role;

-- ── Claim / finish ──
set role service_role;
select pg_temp.ok((select count(*) from public.claim_integration_events('twenty', 200) where pg_temp.mine(payload)) = 4,
  'service role claims the due CRM rows');
select pg_temp.ok((select count(*) from public.claim_integration_events('twenty', 200) where pg_temp.mine(payload)) = 0,
  'claimed rows are leased: a second run gets none');
select id as quote_row from public.integration_outbox where event_type = 'rfq.quote_submitted' and pg_temp.mine(payload) \gset
select public.finish_integration_event(:quote_row, 'retry', 'Twenty 503');
select pg_temp.ok((select status = 'pending' and send_after > now() + interval '1 minute' and last_error = 'Twenty 503' and locked_until is null
                     from public.integration_outbox where id = :quote_row), 'a retry waits with backoff and keeps the error');
update public.integration_outbox set attempts = 8 where id = :quote_row;
select public.finish_integration_event(:quote_row, 'retry', 'still down');
select pg_temp.ok((select status from public.integration_outbox where id = :quote_row) = 'failed', 'the 8th failure is final');
select id as view_row from public.integration_outbox where event_type = 'supplier.profile_viewed' and pg_temp.mine(payload) \gset
select public.finish_integration_event(:view_row, 'sent');
select pg_temp.ok((select status = 'sent' and sent_at is not null and last_error is null from public.integration_outbox where id = :view_row), 'success is final');
select pg_temp.fails($q$select public.finish_integration_event(1, 'bogus')$q$, 'Unknown outcome');
insert into public.crm_links (link_key, crm_id) values ('company:supplier:e33', 'twenty-company-1');
select pg_temp.ok((select crm_id from public.crm_links where link_key = 'company:supplier:e33') = 'twenty-company-1', 'service role writes CRM links');
reset role;

select 'ALL 033 CHECKS PASSED' as result;
