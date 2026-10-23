-- Migration 027: suppliers delete their own drafts (RPC and direct DELETE under RLS); live, ordered,
-- quoted and other suppliers' listings are refused; every delete is in moderation_log.
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
create or replace function pg_temp.deleted(id uuid) returns integer language plpgsql as $$
declare n integer; begin delete from public.products where products.id = deleted.id; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('e2711111-1111-4111-8111-111111111111', 's27@x.test', '{"role":"supplier","full_name":"Sup 27","company_name":"Sup 27 Co","country_code":"CN"}'),
 ('e2722222-2222-4222-8222-222222222222', 'o27@x.test', '{"role":"supplier","full_name":"Other 27","company_name":"Other 27 Co","country_code":"CN"}'),
 ('e2733333-3333-4333-8333-333333333333', 'b27@x.test', '{"role":"importer","full_name":"Buyer 27","company_name":"Buyer 27 Co","country_code":"KE"}');
update public.profiles set kyc_status = 'approved' where id::text like 'e27%';
insert into public.categories (id, slug, name) values ('f2700000-0000-4000-8000-000000000001', 'drafts-27', 'Drafts 27');
insert into public.products (id, supplier_id, category, category_id, title, origin_country, unit_price_cents, trial_units, trial_goods_cents, trial_freight_cents, trial_customs_cents, status) values
 ('f2700000-0000-4000-8000-0000000000d1', 'e2711111-1111-4111-8111-111111111111', 'general', 'f2700000-0000-4000-8000-000000000001', 'Draft one',   'CN', 500, 100, 50000, 0, 0, 'draft'),
 ('f2700000-0000-4000-8000-0000000000d2', 'e2711111-1111-4111-8111-111111111111', 'general', 'f2700000-0000-4000-8000-000000000001', 'Draft two',   'CN', 500, 100, 50000, 0, 0, 'draft'),
 ('f2700000-0000-4000-8000-0000000000d3', 'e2711111-1111-4111-8111-111111111111', 'general', 'f2700000-0000-4000-8000-000000000001', 'Was live',    'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f2700000-0000-4000-8000-0000000000d4', 'e2711111-1111-4111-8111-111111111111', 'general', 'f2700000-0000-4000-8000-000000000001', 'Live one',    'CN', 500, 100, 50000, 5000, 2000, 'live'),
 ('f2700000-0000-4000-8000-0000000000d5', 'e2722222-2222-4222-8222-222222222222', 'general', 'f2700000-0000-4000-8000-000000000001', 'Not mine',    'CN', 500, 100, 50000, 0, 0, 'draft');
insert into public.product_media (product_id, supplier_id, media_type, public_url, storage_path, mime_type, bytes, sort_order)
values ('f2700000-0000-4000-8000-0000000000d1', 'e2711111-1111-4111-8111-111111111111', 'image', 'https://x.test/a.jpg', 'e2711111-1111-4111-8111-111111111111/a.jpg', 'image/jpeg', 2048, 0);

-- An order on a listing that an admin later sent back to draft.
select pg_temp.as_user('e2733333-3333-4333-8333-333333333333');
select (public.create_trial_order('f2700000-0000-4000-8000-0000000000d3', 1)).id as ord \gset
update public.products set status = 'draft' where id = 'f2700000-0000-4000-8000-0000000000d3';

-- ── RPC ──
select pg_temp.as_user('e2733333-3333-4333-8333-333333333333');
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d1')$q$, 'Supplier access required');
select pg_temp.as_user('e2711111-1111-4111-8111-111111111111');
select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d1') as res \gset
select pg_temp.ok((:'res'::jsonb -> 'storage_paths') = '["e2711111-1111-4111-8111-111111111111/a.jpg"]'::jsonb, 'returns the media paths to remove from storage');
select pg_temp.ok(not exists (select 1 from public.products where id = 'f2700000-0000-4000-8000-0000000000d1'), 'draft is gone');
select pg_temp.ok(not exists (select 1 from public.product_media where product_id = 'f2700000-0000-4000-8000-0000000000d1'), 'its media rows cascade');
select pg_temp.ok((select actor_id = 'e2711111-1111-4111-8111-111111111111' and reason = 'Draft deleted by supplier'
                     from public.moderation_log where entity_id = 'f2700000-0000-4000-8000-0000000000d1'), 'delete is in moderation_log with the supplier as actor');
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d4')$q$, 'Only drafts');
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d3')$q$, 'has orders');
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d5')$q$, 'Draft not found');
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d1')$q$, 'Draft not found');

-- A quote that uses a listing: the supplier withdraws it first.
select pg_temp.as_user('e2733333-3333-4333-8333-333333333333');
select (public.submit_rfq('Widgets 27', 'Need widgets for the drafts test', 100, 'Nairobi', null, 'f2700000-0000-4000-8000-000000000001')).id as rfq \gset
select pg_temp.as_user('e2711111-1111-4111-8111-111111111111');
select (public.submit_rfq_quote(:'rfq', 'f2700000-0000-4000-8000-0000000000d4', 400, 10, now() + interval '5 days')).id as quote \gset
update public.products set status = 'draft' where id = 'f2700000-0000-4000-8000-0000000000d4';
select pg_temp.fails($q$select public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d4')$q$, 'Withdraw your quotes');
select public.withdraw_rfq_quote(:'quote');
select pg_temp.ok((public.delete_supplier_draft('f2700000-0000-4000-8000-0000000000d4') ->> 'deleted')::boolean, 'deletable once the quote is withdrawn');

-- ── Direct DELETE under RLS ──
set role authenticated;
select pg_temp.as_user('e2722222-2222-4222-8222-222222222222');
select pg_temp.ok(pg_temp.deleted('f2700000-0000-4000-8000-0000000000d2') = 0, 'another supplier cannot delete it');
select pg_temp.as_user('e2711111-1111-4111-8111-111111111111');
select pg_temp.ok(pg_temp.deleted('f2700000-0000-4000-8000-0000000000d3') = 0, 'RLS keeps a draft with orders');
select pg_temp.ok(pg_temp.deleted('f2700000-0000-4000-8000-0000000000d2') = 1, 'owner deletes a clean draft directly');
reset role;
select pg_temp.ok(exists (select 1 from public.products where id = 'f2700000-0000-4000-8000-0000000000d3'), 'ordered listing still there');
select 'ALL 027 CHECKS PASSED' as result;
