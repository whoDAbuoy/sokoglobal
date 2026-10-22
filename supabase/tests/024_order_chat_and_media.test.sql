-- Migration 024: order chat threads, message types, attachment checks and the chat-attachments bucket.
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
 ('c1111111-1111-4111-8111-111111111111', 's24@x.test', '{"role":"supplier","full_name":"Chat Sup","company_name":"Chat Sup Co","country_code":"US"}'),
 ('c2222222-2222-4222-8222-222222222222', 'b24@x.test', '{"role":"importer","full_name":"Chat Buyer","company_name":"Chat Buyer Co","country_code":"KE"}'),
 ('c3333333-3333-4333-8333-333333333333', 'o24@x.test', '{"role":"supplier","full_name":"Other Sup","company_name":"Other Sup Co","country_code":"US"}'),
 ('c4444444-4444-4444-8444-444444444444', 'x24@x.test', '{"role":"importer","full_name":"Other Buyer","company_name":"Other Buyer Co","country_code":"UG"}');
update public.profiles set kyc_status = 'approved' where id::text like 'c%';
insert into public.categories (id, slug, name) values ('ffffffff-0000-4000-8000-000000000001', 'chat-24', 'Chat 24');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status)
values ('eeeeeeee-0000-4000-8000-000000000001', 'c1111111-1111-4111-8111-111111111111', 'general', 'ffffffff-0000-4000-8000-000000000001', 'Chat test widget', 'US', 500, 100, 50000, 5000, 2000, 'live');

select pg_temp.as_user('c2222222-2222-4222-8222-222222222222');
select (public.create_trial_order('eeeeeeee-0000-4000-8000-000000000001', 1)).id as unpaid \gset
select (public.create_trial_order('eeeeeeee-0000-4000-8000-000000000001', 1)).id as paid \gset
select pg_temp.as_user('');
select reference as ref, amount_minor as amt from public.begin_card_payment('order', :'paid', 'c2222222-2222-4222-8222-222222222222', 'USD', 1) \gset
select public.apply_card_payment(:'ref', 'tx-chat', :amt, 'USD') \gset

-- ── Threads ──
select pg_temp.as_user('c2222222-2222-4222-8222-222222222222');
select pg_temp.fails(format($q$select public.start_order_chat(%L)$q$, :'unpaid'), 'opens once the order is paid');
select (public.start_order_chat(:'paid')).id as thread \gset
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
select pg_temp.ok((public.start_order_chat(:'paid')).id = :'thread', 'supplier opens the same order thread');
select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select pg_temp.fails(format($q$select public.start_order_chat(%L)$q$, :'paid'), 'buyer and supplier only');
select pg_temp.as_user('c2222222-2222-4222-8222-222222222222');
select (public.start_chat_thread('eeeeeeee-0000-4000-8000-000000000001')).id as product_thread \gset
select pg_temp.ok(:'product_thread' <> :'thread', 'product chat and order chat coexist for the same buyer and product');
select pg_temp.ok((public.start_chat_thread('eeeeeeee-0000-4000-8000-000000000001')).id = :'product_thread', 'product chat is still reused');

-- ── Messages (as the API role, so RLS + column grants apply) ──
set role authenticated;
select pg_temp.as_user('c2222222-2222-4222-8222-222222222222');
insert into public.chat_messages (thread_id, sender_id, content, metadata) values (:'thread', auth.uid(), '  Hello, when do you ship?  ', '{"x":1}');
select pg_temp.ok((select content = 'Hello, when do you ship?' and message_type = 'text' and metadata = '{}'::jsonb from public.chat_messages where thread_id = :'thread'), 'text message stored, metadata cleared');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content, message_type) values (%L, auth.uid(), %L, 'image')$q$, :'thread', :'paid' || '/c2222222-2222-4222-8222-222222222222/photo.png'), 'upload the file first');

-- Storage: own folder only, participants only.
insert into storage.objects (bucket_id, name, owner, metadata)
values ('chat-attachments', :'paid' || '/c2222222-2222-4222-8222-222222222222/note-1.webm', auth.uid(), '{"size": 48213, "mimetype": "audio/webm"}'),
       ('chat-attachments', :'paid' || '/c2222222-2222-4222-8222-222222222222/photo.gif', auth.uid(), '{"size": 1200, "mimetype": "image/gif"}');
select pg_temp.fails(format($q$insert into storage.objects (bucket_id, name, metadata) values ('chat-attachments', %L, '{}')$q$, :'paid' || '/c1111111-1111-4111-8111-111111111111/fake.pdf'), 'row-level security');
select pg_temp.fails(format($q$insert into storage.objects (bucket_id, name, metadata) values ('chat-attachments', %L, '{}')$q$, :'unpaid' || '/c2222222-2222-4222-8222-222222222222/x.pdf'), 'row-level security');

insert into public.chat_messages (thread_id, sender_id, content, message_type, metadata)
values (:'thread', auth.uid(), :'paid' || '/c2222222-2222-4222-8222-222222222222/note-1.webm', 'voice_note',
        '{"size": 1, "mime_type": "audio/wav", "duration_seconds": 12.34, "waveform": [10, 55, 100], "evil": "<script>"}');
select pg_temp.ok((select metadata = '{"size": 48213, "mime_type": "audio/webm", "file_name": "note-1.webm", "duration_seconds": 12.3, "waveform": [10, 55, 100]}'::jsonb
                     from public.chat_messages where message_type = 'voice_note'), 'voice note metadata rebuilt from Storage (size, type), unknown keys dropped');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content, message_type) values (%L, auth.uid(), %L, 'image')$q$, :'thread', :'paid' || '/c2222222-2222-4222-8222-222222222222/photo.gif'), 'not allowed');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content, message_type) values (%L, auth.uid(), %L, 'image')$q$, :'thread', :'paid' || '/c1111111-1111-4111-8111-111111111111/note-1.webm'), 'Invalid attachment path');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content, message_type) values (%L, auth.uid(), %L, 'voice_note')$q$, :'product_thread', :'paid' || '/c2222222-2222-4222-8222-222222222222/note-1.webm'), 'only be sent in order chats');
select pg_temp.fails(format($q$update public.chat_messages set content = 'edited' where thread_id = %L$q$, :'thread'), 'permission denied');

-- Reading: participants only.
select pg_temp.as_user('c1111111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.chat_messages where thread_id = :'thread') = 2, 'supplier reads the order chat');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'chat-attachments' and name like :'paid' || '/%') = 2, 'supplier can read the order''s attachments');
select pg_temp.ok((select last_message = '🎤 Voice note' and product_title like 'Order #%' and order_id = :'paid' from public.my_chat_threads() where thread_id = :'thread'), 'inbox shows the order thread with a media preview');
select pg_temp.as_user('c3333333-3333-4333-8333-333333333333');
select pg_temp.ok((select count(*) from public.chat_messages where thread_id = :'thread') = 0, 'other supplier reads nothing');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'chat-attachments') = 0, 'other supplier sees no attachments');
select pg_temp.as_user('c4444444-4444-4444-8444-444444444444');
select pg_temp.fails(format($q$insert into public.chat_messages (thread_id, sender_id, content) values (%L, auth.uid(), 'hi')$q$, :'thread'), 'row-level security');
reset role;

select pg_temp.ok((select file_size_limit = 52428800 and not public from storage.buckets where id = 'chat-attachments'), 'bucket is private with a 50 MB limit');
select 'ALL 024 CHECKS PASSED' as result;
