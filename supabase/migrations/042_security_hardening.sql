-- =============================================================================
-- SokoGlobal — Migration 042: close the 2FA embedding gap, lock the product-media bucket to the
-- supplier's own draft listings, and route supplier KYC documents through the server. Run after 041.
-- Re-runnable.
--
--  * Two-factor on every table. check_request() (041) refuses a session that hasn't passed its 2FA
--    code everywhere except its own profile, but PostgREST resource embedding
--    (GET /profiles?select=*,orders(*)) reads other tables through that allowed path. Every table
--    with row-level security now also carries a RESTRICTIVE "two-factor: verified sessions only"
--    policy, so a pending session gets no rows from them however the request is shaped. Excluded:
--    profiles (the 2FA page needs the caller's own row) and the public settings / reference tables.
--  * product-media uploads: only into {supplier}/{own draft product}/..., and only when the supplier
--    may list (KYC approved, or KYC not required for listings). Before, any supplier could write any
--    path under their own id, unattached to a listing.
--  * kyc_documents: the browser no longer inserts rows directly; app/supplier/verification/actions.ts
--    checks the file's real contents first and inserts with the service role.
-- =============================================================================

-- ── 1. Two-factor on every table ────────────────────────────────────────────
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname not in ('profiles', 'platform_settings', 'exchange_rates', 'system_configs', 'categories')
  loop
    execute format('drop policy if exists "two-factor: verified sessions only" on public.%I', t);
    execute format('create policy "two-factor: verified sessions only" on public.%I as restrictive for all to authenticated '
                || 'using ((select public.two_factor_satisfied())) with check ((select public.two_factor_satisfied()))', t);
  end loop;
end $$;

-- ── 2. product-media: own draft listings only ───────────────────────────────
-- Same rule as products_kyc_guard (017) for creating listings.
create or replace function public.may_upload_listing_media(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.current_role_is('supplier')
     and (not public.kyc_required_for('listings') or public.kyc_approved(auth.uid()))
     and (storage.foldername(p_name))[1] = auth.uid()::text
     and exists (select 1 from public.products p
                  where p.id::text = (storage.foldername(p_name))[2]
                    and p.supplier_id = auth.uid() and p.status = 'draft' and p.deleted_at is null)
$$;
revoke all on function public.may_upload_listing_media(text) from public, anon;
grant execute on function public.may_upload_listing_media(text) to authenticated;

alter policy "storage: suppliers upload to own folder" on storage.objects with check (
  bucket_id = 'product-media' and (select public.may_upload_listing_media(name))
);
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'product-media';

-- ── 3. Supplier KYC documents go through the server ─────────────────────────
revoke insert on public.kyc_documents from authenticated, anon;
