-- Migration 037: every event lands in the bell, whatever the email / SMS preferences; users see and mark
-- only their own; email / SMS routing is unchanged; a failing in-app insert never blocks the rest.
-- Run with `npm run test:db`. Own users; independent of the other test files.
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
 ('e3811111-1111-4111-8111-111111111111', 'n38a@x.test', '{"role":"importer","full_name":"Email On","company_name":"A Co","country_code":"KE"}'),
 ('e3822222-2222-4222-8222-222222222222', 'n38b@x.test', '{"role":"importer","full_name":"All Off","company_name":"B Co","country_code":"KE"}');
update public.profiles set email_notifications = false, sms_alerts = false, order_status_updates = false where id = 'e3822222-2222-4222-8222-222222222222';

select public.enqueue_notification('e3811111-1111-4111-8111-111111111111', 'order.funded', '{"order_id":"x"}', 'n38:a:1');
select public.enqueue_notification('e3811111-1111-4111-8111-111111111111', 'order.funded', '{"order_id":"x"}', 'n38:a:1');
select public.enqueue_notification('e3822222-2222-4222-8222-222222222222', 'order.in_transit', '{"order_id":"y"}', 'n38:b:1');
select public.enqueue_notification('e3822222-2222-4222-8222-222222222222', 'kyc.approved', '{}', 'n38:b:2');

select pg_temp.ok((select count(*) from public.user_notifications where user_id = 'e3811111-1111-4111-8111-111111111111') = 1, 'one bell item per event (repeat is de-duplicated)');
select pg_temp.ok((select count(*) from public.notification_queue where dedupe_key = 'n38:a:1' and channel = 'email') = 1, 'email routing unchanged');
select pg_temp.ok((select count(*) from public.user_notifications where user_id = 'e3822222-2222-4222-8222-222222222222') = 2,
  'a user with email, SMS and order updates all off still gets both events in the bell');
select pg_temp.ok((select count(*) from public.notification_queue where user_id = 'e3822222-2222-4222-8222-222222222222') = 0, 'and still no email or SMS for them');

-- A broken in-app table never blocks email / SMS.
alter table public.user_notifications add constraint user_notifications_test_block check (false) not valid;
select pg_temp.ok(public.enqueue_notification('e3811111-1111-4111-8111-111111111111', 'kyc.approved', '{}', 'n38:a:2') = 1, 'email still queued when the in-app insert fails');
alter table public.user_notifications drop constraint user_notifications_test_block;

set role authenticated;
select pg_temp.as_user('e3811111-1111-4111-8111-111111111111');
select pg_temp.ok((select count(*) from public.user_notifications) = 1, 'users read only their own notifications');
select pg_temp.fails($q$update public.user_notifications set read_at = now()$q$, 'permission denied');
select pg_temp.fails($q$insert into public.user_notifications (user_id, template_key, dedupe_key) values ('e3811111-1111-4111-8111-111111111111', 'order.funded', 'forged')$q$, 'permission denied');
select pg_temp.fails($q$select public.enqueue_notification('e3811111-1111-4111-8111-111111111111', 'order.funded', '{}', 'forged')$q$, 'permission denied');
select pg_temp.ok(public.mark_notifications_read() = 1, 'mark all read');
select pg_temp.ok(public.mark_notifications_read() = 0, 'marking again changes nothing');
reset role;
select public.enqueue_notification('e3811111-1111-4111-8111-111111111111', 'kyc.approved', '{}', 'n38:a:3');   -- A: a new unread item
set role authenticated;
select pg_temp.as_user('e3822222-2222-4222-8222-222222222222');
select pg_temp.ok(public.mark_notifications_read(array[(select id from public.user_notifications where dedupe_key = 'n38:a:3')]) = 0,
  'another user''s id is ignored (RLS hides it, and the update is scoped to the caller)');
select pg_temp.ok(public.mark_notifications_read(array[(select id from public.user_notifications where dedupe_key = 'n38:b:1')]) = 1, 'mark one read by id');
select pg_temp.ok((select count(*) from public.user_notifications where read_at is null) = 1, 'the other stays unread');
select pg_temp.ok(public.mark_notifications_read(array[(select id from public.user_notifications where dedupe_key = 'n38:b:2')]) = 1, 'own id only');
reset role;
select pg_temp.ok((select read_at is null from public.user_notifications where dedupe_key = 'n38:a:3'), 'another user''s notification was not touched');
select pg_temp.ok((select count(*) from public.user_notifications where dedupe_key = 'n38:a:2') = 0, 'the blocked in-app insert left no half row');
set role anon;
select pg_temp.fails($q$select public.mark_notifications_read()$q$, 'permission denied');
reset role;

select 'ALL 037 CHECKS PASSED' as result;
