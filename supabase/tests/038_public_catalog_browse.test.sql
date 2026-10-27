-- Migration 038: public browsing (paged, live listings only, banned suppliers hidden) and sitemap names.
-- Uses the fixtures created by 036_public_catalog.test.sql (run before this file). Run with `npm run test:db`.
\set ON_ERROR_STOP 1
\set QUIET 1
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; raise notice 'pass: %', msg; end $$;
grant execute on all functions in schema pg_temp to anon;

set role anon;
select pg_temp.ok((select count(*) from public.public_browse_listings(48, 0) where title like '% 37') = 2, 'browse: the two public listings, no draft / removed / banned');
select pg_temp.ok((select bool_and(total = (select count(*) from public.public_browse_listings(48, 0))) from public.public_browse_listings(48, 0)), 'browse: total matches the rows');
select pg_temp.ok((select count(*) from public.public_browse_listings(1, 0)) = 1, 'browse: page size honoured');
select pg_temp.ok((select count(*) from public.public_browse_listings(1000, 0)) <= 48, 'browse: page size capped at 48');
select pg_temp.ok((select (select id from public.public_browse_listings(1, 0)) <> (select id from public.public_browse_listings(1, 1))), 'browse: offset moves to the next item');
select pg_temp.ok((select name from public.public_sitemap_entries() where id = 'f3700000-0000-4000-8000-0000000000a1') = 'Steel kettle 37', 'sitemap: product name');
select pg_temp.ok((select name from public.public_sitemap_entries() where id = 'e3711111-1111-4111-8111-111111111111') = 'Kettle Works Ltd', 'sitemap: supplier name');
reset role;

select 'ALL 038 CHECKS PASSED' as result;
