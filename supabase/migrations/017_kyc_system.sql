-- =============================================================================
-- SokoGlobal — Migration 017: platform-wide KYC. Run after 016. Re-runnable.
--
--  * profiles.kyc_status (unsubmitted | pending | approved | rejected) is the one
--    flag every guard reads. The older boolean profiles.kyc_verified (supplier
--    KYC, migration 003; payouts and badges read it) is kept in sync both ways
--    by trigger, and the supplier KYC flow keeps working unchanged.
--  * kyc_verifications: identity / business documents for any account
--    (importers use /dashboard/kyc; suppliers keep /supplier/verification).
--    Owners read their own rows; only super admins see and review all of them.
--    Files live in the private `kyc-documents` bucket under <uid>/verification/.
--  * An account is approved when it has an approved identity document
--    (national ID or passport) AND an approved business document (business
--    licence or tax certificate).
--  * Guards: listing creation and new escrow orders require kyc_status =
--    'approved' (switchable per action in migration 018 / the control room).
--    Supplier payouts already require KYC (begin_payout, migration 003).
-- =============================================================================

do $$ begin
  create type public.kyc_status_enum as enum ('unsubmitted', 'pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.kyc_document_type as enum ('national_id', 'passport', 'business_license', 'tax_certificate');
exception when duplicate_object then null; end $$;

-- ── 1. Profile status ───────────────────────────────────────────────────────
alter table public.profiles add column if not exists kyc_status      public.kyc_status_enum not null default 'unsubmitted';
alter table public.profiles add column if not exists kyc_verified_at timestamptz;

-- Backfill from the supplier KYC flow (003) before the sync trigger exists.
update public.profiles p set kyc_status = 'approved', kyc_verified_at = coalesce(p.kyc_verified_at, k.reviewed_at, now())
  from public.supplier_kyc k
 where k.supplier_id = p.id and p.kyc_verified and p.kyc_status <> 'approved';
update public.profiles set kyc_status = 'approved', kyc_verified_at = coalesce(kyc_verified_at, now())
 where kyc_verified and kyc_status <> 'approved';
update public.profiles p set kyc_status = case k.status::text when 'submitted' then 'pending'::public.kyc_status_enum else 'rejected'::public.kyc_status_enum end
  from public.supplier_kyc k
 where k.supplier_id = p.id and not p.kyc_verified and k.status::text in ('submitted', 'rejected') and p.kyc_status = 'unsubmitted';

-- kyc_status ⇄ kyc_verified, whichever one a function changes.
create or replace function public.profiles_sync_kyc()
returns trigger language plpgsql as $$
begin
  if new.kyc_verified is distinct from old.kyc_verified and new.kyc_status is not distinct from old.kyc_status then
    new.kyc_status := case when new.kyc_verified then 'approved'::public.kyc_status_enum else 'rejected'::public.kyc_status_enum end;
  elsif new.kyc_status is distinct from old.kyc_status then
    new.kyc_verified := new.kyc_status = 'approved';
  end if;
  new.kyc_verified_at := case when new.kyc_status = 'approved' then coalesce(new.kyc_verified_at, now()) else null end;
  return new;
end $$;
drop trigger if exists profiles_sync_kyc on public.profiles;
create trigger profiles_sync_kyc before update of kyc_verified, kyc_status on public.profiles
  for each row execute function public.profiles_sync_kyc();

-- Supplier KYC submitted → pending (approval / rejection already flow through kyc_verified).
create or replace function public.supplier_kyc_sync_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text = 'submitted' and old.status is distinct from new.status then
    update public.profiles set kyc_status = 'pending' where id = new.supplier_id and kyc_status <> 'approved';
  end if;
  return new;
end $$;
drop trigger if exists supplier_kyc_sync_status on public.supplier_kyc;
create trigger supplier_kyc_sync_status after update of status on public.supplier_kyc
  for each row execute function public.supplier_kyc_sync_status();

-- ── 2. Verifications ────────────────────────────────────────────────────────
create table if not exists public.kyc_verifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  document_type    public.kyc_document_type not null,
  document_number  text not null check (document_number ~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{2,39}$'),
  -- Object path in the private kyc-documents bucket ("<uid>/verification/<uuid>.<ext>"); never a public URL.
  document_url     text not null check (document_url ~ '^[0-9a-f-]{36}/verification/[0-9a-f-]{36}\.(pdf|jpg|png)$'),
  status           public.kyc_status_enum not null default 'pending' check (status <> 'unsubmitted'),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) between 5 and 1000),
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint kyc_verification_path_owner check (document_url like user_id::text || '/verification/%'),
  constraint kyc_rejection_has_reason check (status <> 'rejected' or rejection_reason is not null)
);
create index if not exists kyc_verifications_queue_idx on public.kyc_verifications (status, created_at) where status = 'pending';
create index if not exists kyc_verifications_user_idx on public.kyc_verifications (user_id, created_at desc);
create unique index if not exists kyc_verifications_one_pending_per_type on public.kyc_verifications (user_id, document_type) where status = 'pending';
drop trigger if exists kyc_verifications_touch on public.kyc_verifications;
create trigger kyc_verifications_touch before update on public.kyc_verifications for each row execute function public.touch_updated_at();

alter table public.kyc_verifications enable row level security;
drop policy if exists "kyc_verifications: own read" on public.kyc_verifications;
drop policy if exists "kyc_verifications: own submit" on public.kyc_verifications;
drop policy if exists "kyc_verifications: own withdraw" on public.kyc_verifications;
drop policy if exists "kyc_verifications: super admin reads" on public.kyc_verifications;
drop policy if exists "kyc_verifications: super admin reviews" on public.kyc_verifications;
create policy "kyc_verifications: own read" on public.kyc_verifications for select to authenticated using (user_id = (select auth.uid()));
create policy "kyc_verifications: own submit" on public.kyc_verifications for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and reviewed_by is null);
create policy "kyc_verifications: own withdraw" on public.kyc_verifications for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'pending');
create policy "kyc_verifications: super admin reads" on public.kyc_verifications for select to authenticated using ((select public.is_super_admin()));
create policy "kyc_verifications: super admin reviews" on public.kyc_verifications for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
-- Writes go through the functions below (they validate the file and recompute the account status).
revoke all on public.kyc_verifications from anon, authenticated;
grant select on public.kyc_verifications to authenticated;

-- ── 3. Storage (bucket from migration 003; identity files under <uid>/verification/) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false;

drop policy if exists "kyc storage: user uploads own verification" on storage.objects;
create policy "kyc storage: user uploads own verification" on storage.objects for insert to authenticated with check (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] = 'verification');
-- Submitted evidence cannot be deleted from the browser (withdrawal removes it server-side).
drop policy if exists "kyc storage: supplier deletes own" on storage.objects;
create policy "kyc storage: supplier deletes own" on storage.objects for delete to authenticated using (
  bucket_id = 'kyc-documents' and (storage.foldername(name))[1] = (select auth.uid())::text
  and coalesce((storage.foldername(name))[2], '') <> 'verification');
-- Admins keep reading supplier KYC files; identity verifications are super-admin only.
drop policy if exists "kyc storage: admin reads" on storage.objects;
create policy "kyc storage: admin reads" on storage.objects for select to authenticated using (
  bucket_id = 'kyc-documents' and (select public.current_role_is('admin'))
  and (coalesce((storage.foldername(name))[2], '') <> 'verification' or (select public.is_super_admin())));

-- ── 4. Status rules ─────────────────────────────────────────────────────────
create or replace function public.kyc_requirements_met(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kyc_verifications where user_id = p_user and status = 'approved' and document_type in ('national_id', 'passport'))
     and exists (select 1 from public.kyc_verifications where user_id = p_user and status = 'approved' and document_type in ('business_license', 'tax_certificate'))
$$;

-- Recomputes profiles.kyc_status from the user's documents. Never downgrades an approved account
-- (revoking approval is a deliberate admin action, not a side effect of one rejected document).
create or replace function public.refresh_kyc_status(p_user uuid)
returns public.kyc_status_enum language plpgsql security definer set search_path = public as $$
declare v_now public.kyc_status_enum; v_next public.kyc_status_enum;
begin
  select kyc_status into v_now from public.profiles where id = p_user for update;
  if not found or v_now = 'approved' then return v_now; end if;
  v_next := case
    when public.kyc_requirements_met(p_user) then 'approved'
    when exists (select 1 from public.kyc_verifications where user_id = p_user and status = 'pending') then 'pending'
    when exists (select 1 from public.kyc_verifications where user_id = p_user and status = 'rejected') then 'rejected'
    when exists (select 1 from public.supplier_kyc where supplier_id = p_user and status::text = 'submitted') then 'pending'
    else 'unsubmitted' end;
  if v_next is distinct from v_now then update public.profiles set kyc_status = v_next where id = p_user; end if;
  return v_next;
end $$;
revoke all on function public.refresh_kyc_status(uuid) from public, anon, authenticated;
revoke all on function public.kyc_requirements_met(uuid) from public, anon, authenticated;

-- Submit one document (the file must already be uploaded to the caller's own verification folder).
create or replace function public.submit_kyc_verification(p_document_type public.kyc_document_type, p_document_number text, p_document_url text)
returns public.kyc_verifications language plpgsql security definer set search_path = public as $$
declare v public.kyc_verifications; v_status public.kyc_status_enum; v_num text := upper(btrim(coalesce(p_document_number, '')));
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select kyc_status into v_status from public.profiles where id = auth.uid();
  if v_status = 'approved' then raise exception 'Your account is already verified'; end if;
  if v_num !~ '^[A-Z0-9][A-Z0-9 /.-]{2,39}$' then raise exception 'Enter the document number as printed (3–40 letters or digits)'; end if;
  if p_document_url is null or p_document_url not like auth.uid()::text || '/verification/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'kyc-documents' and o.name = p_document_url) then
    raise exception 'Upload the document file first';
  end if;
  if exists (select 1 from public.kyc_verifications where user_id = auth.uid() and document_url = p_document_url) then
    raise exception 'This file was already submitted';
  end if;
  if exists (select 1 from public.kyc_verifications where user_id = auth.uid() and document_type = p_document_type and status = 'pending') then
    raise exception 'A % is already awaiting review; withdraw it to replace it', replace(p_document_type::text, '_', ' ');
  end if;
  insert into public.kyc_verifications (user_id, document_type, document_number, document_url)
  values (auth.uid(), p_document_type, v_num, p_document_url) returning * into v;
  perform public.refresh_kyc_status(auth.uid());
  return v;
end $$;

-- Withdraw a pending document; returns the file path so the server can delete it.
create or replace function public.withdraw_kyc_verification(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  delete from public.kyc_verifications where id = p_id and user_id = auth.uid() and status = 'pending' returning document_url into v_path;
  if v_path is null then raise exception 'Only documents awaiting review can be withdrawn'; end if;
  perform public.refresh_kyc_status(auth.uid());
  return v_path;
end $$;

-- Super admin review (audited; 2FA-verified session required when 2FA is on, via migration 016).
create or replace function public.super_review_kyc_verification(p_id uuid, p_approve boolean, p_reason text default null,
  p_ip text default null, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.kyc_verifications; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_status public.kyc_status_enum;
begin
  if not public.is_super_admin() then raise exception 'Super admin access required' using errcode = '42501'; end if;
  select * into v from public.kyc_verifications where id = p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if v.status <> 'pending' then raise exception 'This submission was already reviewed'; end if;
  if v.user_id = auth.uid() then raise exception 'You cannot review your own documents'; end if;
  if not p_approve and char_length(coalesce(v_reason, '')) < 5 then raise exception 'Tell the user what to fix (5+ characters)'; end if;

  update public.kyc_verifications
     set status = case when p_approve then 'approved'::public.kyc_status_enum else 'rejected'::public.kyc_status_enum end,
         rejection_reason = case when p_approve then null else left(v_reason, 1000) end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id returning * into v;
  v_status := public.refresh_kyc_status(v.user_id);
  perform public.write_admin_audit(case when p_approve then 'kyc.approve' else 'kyc.reject' end, 'user', v.user_id::text,
    jsonb_build_object('verification_id', v.id, 'document_type', v.document_type, 'reason', v_reason, 'account_status', v_status), p_ip, p_ua);
  return jsonb_build_object('verification', to_jsonb(v), 'account_status', v_status);
end $$;

-- ── 5. Guards ───────────────────────────────────────────────────────────────
-- Whether an action needs an approved KYC: the control-room switch (system_configs, migration 018), default on.
create or replace function public.kyc_required_for(p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_action not in ('listings', 'orders') then return false; end if;
  if to_regclass('public.system_configs') is null then return true; end if;
  execute 'select value ->> $1 from public.system_configs where key = ''kyc_requirements''' into v using p_action;
  return coalesce(v::boolean, true);
end $$;

create or replace function public.kyc_approved(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select kyc_status = 'approved' from public.profiles where id = p_user), false)
$$;

create or replace function public.guard_kyc_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.kyc_required_for('listings') and not public.kyc_approved(auth.uid()) then
    raise exception 'Complete business verification (KYC) before creating listings' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists products_kyc_guard on public.products;
create trigger products_kyc_guard before insert on public.products for each row execute function public.guard_kyc_listing();

create or replace function public.guard_kyc_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.kyc_required_for('orders') and not public.kyc_approved(auth.uid()) then
    raise exception 'Complete identity verification (KYC) before placing escrow orders' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['orders', 'checkout_groups', 'pool_members'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_kyc_guard', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.guard_kyc_order()', t || '_kyc_guard', t);
  end loop;
end $$;

-- Middleware state (replaces the 016 version): + KYC status and which actions need it.
create or replace function public.my_security_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_banned', coalesce(p.is_banned, false),
    'two_factor_enabled', coalesce(p.two_factor_enabled, false),
    'two_factor_ok', public.two_factor_satisfied(),
    'kyc_status', p.kyc_status,
    'kyc_required', jsonb_build_object('listings', public.kyc_required_for('listings'), 'orders', public.kyc_required_for('orders')))
    from public.profiles p where p.id = auth.uid()
$$;

-- ── 6. Grants ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.submit_kyc_verification(public.kyc_document_type, text, text)', 'public.withdraw_kyc_verification(uuid)',
    'public.super_review_kyc_verification(uuid, boolean, text, text, text)', 'public.my_security_state()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
