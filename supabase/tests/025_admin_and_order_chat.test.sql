-- Migration 025: order chat from quote acceptance, super-admin access, direct support threads,
-- honest read receipts, admin flag + alerts, attachments in every thread, admin deletes.
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
create or replace function pg_temp.deleted_msg(m uuid) returns integer language plpgsql as $$
declare n integer; begin delete from public.chat_messages where id = m; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('d1111111-1111-4111-8111-111111111111', 's25@x.test',  '{"role":"supplier","full_name":"Sup 25","company_name":"Sup 25 Co","country_code":"US"}'),
 ('d2222222-2222-4222-8222-222222222222', 'b25@x.test',  '{"role":"importer","full_name":"Buyer 25","company_name":"Buyer 25 Co","country_code":"KE"}'),
 ('d3333333-3333-4333-8333-333333333333', 'o25@x.test',  '{"role":"supplier","full_name":"Other Sup 25","company_name":"Other Sup 25 Co","country_code":"US"}'),
 ('d4444444-4444-4444-8444-444444444444', 'x25@x.test',  '{"role":"importer","full_name":"Other Buyer 25","company_name":"Other Buyer 25 Co","country_code":"UG"}'),
 ('d5555555-5555-4555-8555-555555555555', 'sa25@x.test', '{"role":"importer","full_name":"Desk Admin","company_name":"SokoGlobal","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'd%';
update public.profiles set role = 'super_admin' where id = 'd5555555-5555-4555-8555-555555555555';
insert into public.categories (id, slug, name) values ('f2500000-0000-4000-8000-000000000001', 'chat-25', 'Chat 25');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('f2500000-0000-4000-8000-0000000000aa', 'd1111111-1111-4111-8111-111111111111', 'general', 'f2500000-0000-4000-8000-000000000001', 'Chat 25 widget', 'US', 500, 100, 50000, 5000, 2000, 'live');

-- ── Order chat opens at quote acceptance (RFQ orders), not for other unpaid orders ──
select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select (public.submit_rfq('Widgets 25', 'Need 500 widgets for chat test', 500, 'Nairobi', null, 'f2500000-0000-4000-8000-000000000001')).id as rfq \gset
select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
select (public.submit_rfq_quote(:'rfq', 'f2500000-0000-4000-8000-0000000000aa', 400, 100, now() + interval '5 days')).id as quote \gset
select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select (public.accept_rfq_quote(:'quote', 'full')).id as rfq_order \gset
select (public.create_trial_order('f2500000-0000-4000-8000-0000000000aa', 1)).id as trial_unpaid \gset
select (public.start_order_chat(:'rfq_order')).id as order_thread \gset
select pg_temp.ok((select kind = 'order' from public.chat_threads where id = :'order_thread'), 'buyer opens chat on an accepted, unpaid quote');
select pg_temp.fails(format($q$select public.start_order_chat(%L)$q$, :'trial_unpaid'), 'opens once the order is paid');
select pg_temp.as_user('d1111111-1111-4111-8111-111111111111');
select pg_temp.ok((public.start_order_chat(:'rfq_order')).id = :'order_thread', 'the quoting supplier joins the same thread');

-- ── Product thread between buyer and supplier ──
select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select (public.start_chat_thread('f2500000-0000-4000-8000-0000000000aa')).id as product_thread \gset
set role authenticated;
insert into public.chat_messages (thread_id, sender_id, content) values (:'product_thread', auth.uid(), 'Do you ship to Nairobi?');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content, from_admin) values (%L, auth.uid(), 'fake', true)$q$, :'product_thread'), 'permission denied');
select pg_temp.ok((select not from_admin from public.chat_messages where thread_id = :'product_thread'), 'user messages are never flagged as admin');

-- Super admin sees and can post in any thread; observing marks nothing read.
select pg_temp.as_user('d5555555-5555-4555-8555-555555555555');
select pg_temp.ok((select count(*) from public.chat_messages where thread_id = :'product_thread') = 1, 'super admin reads a buyer↔supplier thread');
select pg_temp.ok(public.mark_chat_read(:'product_thread') = 0, 'an observing admin marks nothing read');
insert into public.chat_messages (thread_id, sender_id, content) values (:'product_thread', auth.uid(), 'SokoGlobal here: shipping to Nairobi is covered.');
select pg_temp.ok((select from_admin from public.chat_messages where thread_id = :'product_thread' and sender_id = auth.uid()), 'admin message is flagged from_admin');
reset role;
select pg_temp.ok((select count(*) from public.notification_queue where template_key = 'support.admin_message' and payload ->> 'thread_id' = :'product_thread'
                     and payload ? 'role' and user_id in ('d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222')) = 2, 'buyer and supplier are alerted (with their role for the inbox link)');
select pg_temp.ok((select read_at is null from public.chat_messages where thread_id = :'product_thread' and sender_id = 'd2222222-2222-4222-8222-222222222222'), 'buyer message still unread for the supplier');

-- ── Direct support thread ──
set role authenticated;
select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select pg_temp.fails($q$select public.start_direct_thread('d4444444-4444-4444-8444-444444444444')$q$, 'Super admin access required');
select pg_temp.as_user('d5555555-5555-4555-8555-555555555555');
select (public.start_direct_thread('d2222222-2222-4222-8222-222222222222')).id as direct \gset
select pg_temp.ok((public.start_direct_thread('d2222222-2222-4222-8222-222222222222')).id = :'direct', 'one direct thread per user');
insert into public.chat_messages (thread_id, sender_id, content) values (:'direct', auth.uid(), 'Hello from SokoGlobal support.');
-- Admin attachment in the direct thread (thread-id scope).
insert into storage.objects (bucket_id, name, owner, metadata)
values ('chat-attachments', :'direct' || '/d5555555-5555-4555-8555-555555555555/guide.pdf', auth.uid(), '{"size": 2048, "mimetype": "application/pdf"}');
insert into public.chat_messages (thread_id, sender_id, content, message_type) values (:'direct', auth.uid(), :'direct' || '/d5555555-5555-4555-8555-555555555555/guide.pdf', 'document');
select pg_temp.fails(format($q$insert into storage.objects (bucket_id, name, metadata) values ('chat-attachments', %L, '{}')$q$, :'direct' || '/d2222222-2222-4222-8222-222222222222/spoof.pdf'), 'row-level security');

select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select pg_temp.ok((select counterpart_name = 'SokoGlobal Support' and kind = 'direct' and last_from_admin and unread_count = 2
                     from public.my_chat_threads() where thread_id = :'direct'), 'user sees "SokoGlobal Support" with an admin badge and unread count');
select pg_temp.ok((public.chat_unread_summary() ->> 'from_admin')::int >= 2, 'header summary counts admin messages');
select pg_temp.ok((select count(*) from storage.objects where name like :'direct' || '/%') = 1, 'user can open the admin''s attachment');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('chat-attachments', :'direct' || '/d2222222-2222-4222-8222-222222222222/reply.png', auth.uid(), '{"size": 900, "mimetype": "image/png"}');
insert into public.chat_messages (thread_id, sender_id, content, message_type) values (:'direct', auth.uid(), :'direct' || '/d2222222-2222-4222-8222-222222222222/reply.png', 'image');
select pg_temp.ok(public.mark_chat_read(:'direct') = 2, 'user reads the desk''s messages');

select pg_temp.as_user('d5555555-5555-4555-8555-555555555555');
select pg_temp.ok((select count(*) from public.admin_chat_threads('direct', 'Buyer 25')) = 1, 'chat center filters by kind and searches by company');
select pg_temp.ok((select count(*) from public.admin_chat_threads('order', null) where thread_id = :'order_thread') = 1, 'chat center lists order chats');
select pg_temp.ok(public.mark_chat_read(:'direct') = 1, 'desk reads the user''s reply');
select id as admin_doc from public.chat_messages where thread_id = :'direct' and message_type = 'document' \gset

-- ── Isolation and deletes ──
select pg_temp.as_user('d4444444-4444-4444-8444-444444444444');
select pg_temp.ok((select count(*) from public.chat_messages where thread_id in (:'direct', :'product_thread', :'order_thread')) = 0, 'other users read none of these threads');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'chat-attachments' and name like :'direct' || '/%') = 0, 'nor their attachments');
select pg_temp.fails($q$select public.admin_chat_threads()$q$, 'Super admin access required');
select pg_temp.as_user('d3333333-3333-4333-8333-333333333333');
select pg_temp.ok((select count(*) from public.chat_messages where thread_id = :'product_thread') = 0, 'another supplier cannot read the product thread');
select pg_temp.as_user('d2222222-2222-4222-8222-222222222222');
select pg_temp.ok(pg_temp.deleted_msg(:'admin_doc') = 0, 'users cannot delete messages');
select pg_temp.as_user('d5555555-5555-4555-8555-555555555555');
select pg_temp.ok(pg_temp.deleted_msg(:'admin_doc') = 1, 'super admin deletes a message');
reset role;
select 'ALL 025 CHECKS PASSED' as result;
