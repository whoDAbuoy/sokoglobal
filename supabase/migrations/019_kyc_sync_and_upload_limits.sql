-- =============================================================================
-- SokoGlobal — Migration 019: KYC status sync hardening + no upload size caps.
-- Run after 018. Re-runnable.
--
--  * profiles_sync_kyc() (017) only fired on UPDATE, so rows inserted with
--    kyc_verified = true (seed scripts, manual inserts, restores) kept
--    kyc_status = 'unsubmitted' and the buyer dashboard kept showing
--    "Verify your business to place orders". It now fires on INSERT too.
--  * Every approval path writes kyc_status = 'approved' and kyc_verified_at
--    explicitly (refresh_kyc_status for /admin/kyc identity reviews,
--    admin_approve_kyc for supplier KYC) instead of relying on the trigger.
--  * One-off resync of any profile whose kyc_status, kyc_verified,
--    kyc_verified_at and approved documents disagree.
--  * Storage buckets lose their per-file size limit (NULL = the project-wide
--    "Upload file size limit" in Supabase → Storage settings applies), and the
--    byte-count columns become bigint so files over 2 GB can be recorded.
-- =============================================================================

-- ── 1. Sync trigger: INSERT as well as UPDATE ───────────────────────────────
create or replace function public.profiles_sync_kyc()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.kyc_verified then new.kyc_status := 'approved';
    elsif new.kyc_status = 'approved' then new.kyc_verified := true;
    end if;
  elsif new.kyc_verified is distinct from old.kyc_verified and new.kyc_status is not distinct from old.kyc_status then
    new.kyc_status := case when new.kyc_verified then 'approved'::public.kyc_status_enum else 'rejected'::public.kyc_status_enum end;
  elsif new.kyc_status is distinct from old.kyc_status then
    new.kyc_verified := new.kyc_status = 'approved';
  end if;
  new.kyc_verified_at := case when new.kyc_status = 'approved' then coalesce(new.kyc_verified_at, now()) else null end;
  return new;
end $$;
drop trigger if exists profiles_sync_kyc on public.profiles;
create trigger profiles_sync_kyc before insert or update of kyc_verified, kyc_status on public.profiles
  for each row execute function public.profiles_sync_kyc();

-- ── 2. Approval paths write the status explicitly ──────────────────────────
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
  if v_next is distinct from v_now then
    update public.profiles
       set kyc_status = v_next,
           kyc_verified = v_next = 'approved',
           kyc_verified_at = case when v_next = 'approved' then now() end
     where id = p_user;
  end if;
  return v_next;
end $$;
revoke all on function public.refresh_kyc_status(uuid) from public, anon, authenticated;

-- Same as migration 003, plus kyc_status / kyc_verified_at in the same statement.
create or replace function public.admin_approve_kyc(p_supplier_id uuid, p_notes text default null)
returns public.supplier_kyc language plpgsql security definer set search_path = public as $$
declare v_kyc public.supplier_kyc;
begin
  if not public.current_role_is('admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  select * into v_kyc from public.supplier_kyc where supplier_id = p_supplier_id for update;
  if not found or v_kyc.status <> 'submitted' then raise exception 'Supplier is not awaiting KYC review'; end if;
  if not exists (select 1 from public.supplier_payout_accounts where supplier_id = p_supplier_id) then
    raise exception 'Supplier has no payout account on file';
  end if;

  update public.supplier_kyc
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = nullif(trim(p_notes), ''), updated_at = now()
   where supplier_id = p_supplier_id returning * into v_kyc;
  update public.profiles
     set kyc_verified = true, kyc_status = 'approved', kyc_verified_at = coalesce(kyc_verified_at, now())
   where id = p_supplier_id;
  update public.supplier_payout_accounts
     set verified = true, verified_by = auth.uid(), verified_at = now()
   where supplier_id = p_supplier_id;
  return v_kyc;
end $$;
revoke all on function public.admin_approve_kyc(uuid, text) from public, anon;
grant execute on function public.admin_approve_kyc(uuid, text) to authenticated;

-- ── 3. One-off resync of drifted profiles ──────────────────────────────────
update public.profiles p
   set kyc_status = 'approved', kyc_verified = true, kyc_verified_at = coalesce(p.kyc_verified_at, now())
 where (p.kyc_verified or p.kyc_status = 'approved' or public.kyc_requirements_met(p.id))
   and (p.kyc_status <> 'approved' or not p.kyc_verified or p.kyc_verified_at is null);

-- Accounts with documents whose status was never recomputed (e.g. edited by hand).
select public.refresh_kyc_status(u.user_id)
  from (select distinct user_id from public.kyc_verifications) u
  join public.profiles p on p.id = u.user_id
 where p.kyc_status <> 'approved';

-- ── 4. Storage: no per-file size caps ──────────────────────────────────────
update storage.buckets set file_size_limit = null where id in ('product-media', 'kyc-documents', 'avatars');

alter table public.product_media alter column bytes type bigint;
alter table public.kyc_documents alter column bytes type bigint;
