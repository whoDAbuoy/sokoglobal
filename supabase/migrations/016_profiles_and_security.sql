-- =============================================================================
-- SokoGlobal — Migration 016: self-service profile fields, avatars, TOTP 2FA.
-- Run after 015. Re-runnable.
--
--  * profiles: avatar_url, phone_number, designation, notification preferences
--    (users edit these directly) and two_factor_enabled (server only).
--    full_name / company_name keep the admin-approved change flow from 012.
--  * user_totp_secrets: one row per user. The secret is AES-256-GCM ciphertext
--    and backup codes are keyed hashes; both are written only by the server
--    (service role) after it has verified a code. The browser can read
--    whether 2FA is set up, never the secret.
--  * two_factor_sessions: which Supabase sessions (JWT session_id) passed a
--    2FA check, until when. two_factor_satisfied() reads it, so Postgres
--    itself refuses audited admin actions and money overrides from a session
--    that skipped the code, even when called straight through the API.
--  * Storage bucket `avatars` (public read; each user writes only <uid>/…).
-- =============================================================================

-- ── 1. Profile fields ───────────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_url           text;
alter table public.profiles add column if not exists phone_number         text;
alter table public.profiles add column if not exists company_name         text;   -- exists since schema.sql; kept for completeness
alter table public.profiles add column if not exists designation          text;
alter table public.profiles add column if not exists email_notifications  boolean not null default true;
alter table public.profiles add column if not exists sms_alerts           boolean not null default false;
alter table public.profiles add column if not exists order_status_updates boolean not null default true;
alter table public.profiles add column if not exists two_factor_enabled   boolean not null default false;

alter table public.profiles drop constraint if exists profiles_phone_e164;
alter table public.profiles add constraint profiles_phone_e164 check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{7,14}$');
alter table public.profiles drop constraint if exists profiles_designation_len;
alter table public.profiles add constraint profiles_designation_len check (designation is null or char_length(designation) between 2 and 80);
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len check (avatar_url is null or char_length(avatar_url) <= 500);
alter table public.profiles drop constraint if exists profiles_sms_needs_phone;
alter table public.profiles add constraint profiles_sms_needs_phone check (not sms_alerts or phone_number is not null);

-- A user may only point avatar_url at their own folder in the avatars bucket (no hot-linked or third-party images).
create or replace function public.profiles_guard_avatar()
returns trigger language plpgsql as $$
begin
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url and auth.uid() is not null
     and new.avatar_url !~ ('^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/avatars/' || new.id::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'Avatar must be an image uploaded to your own avatars folder';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_avatar on public.profiles;
create trigger profiles_guard_avatar before update of avatar_url on public.profiles
  for each row execute function public.profiles_guard_avatar();

-- Self-service columns only. Name / business name stay behind submit_profile_change();
-- role, KYC, bans and two_factor_enabled are never user-writable.
grant update (avatar_url, phone_number, designation, email_notifications, sms_alerts, order_status_updates)
  on public.profiles to authenticated;

-- ── 2. TOTP secrets ─────────────────────────────────────────────────────────
create table if not exists public.user_totp_secrets (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  secret         text not null check (char_length(secret) between 20 and 400),   -- "v1.<iv>.<tag>.<ciphertext>" (AES-256-GCM)
  is_verified    boolean not null default false,
  backup_codes   text[] not null default array[]::text[],                         -- HMAC-SHA256 of each unused code
  last_used_step bigint,                                                          -- replay guard: TOTP steps at or below this are refused
  created_at     timestamptz not null default now(),
  verified_at    timestamptz,
  constraint totp_backup_codes_max check (cardinality(backup_codes) <= 20)
);

alter table public.user_totp_secrets enable row level security;
drop policy if exists "totp: own read" on public.user_totp_secrets;
drop policy if exists "totp: own write" on public.user_totp_secrets;
create policy "totp: own read" on public.user_totp_secrets for select to authenticated using (user_id = (select auth.uid()));
create policy "totp: own write" on public.user_totp_secrets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- RLS limits rows to the owner; grants limit columns. The browser may see whether 2FA is
-- set up, never the secret or the backup hashes, and cannot write (enrolment is server-side).
revoke all on public.user_totp_secrets from anon, authenticated;
grant select (user_id, is_verified, created_at, verified_at) on public.user_totp_secrets to authenticated;

-- ── 3. 2FA sessions ─────────────────────────────────────────────────────────
create table if not exists public.two_factor_sessions (
  session_id  uuid primary key,              -- Supabase JWT "session_id"
  user_id     uuid not null references auth.users (id) on delete cascade,
  method      text not null check (method in ('totp', 'backup_code', 'enrolment')),
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text check (ip is null or char_length(ip) <= 64),
  user_agent  text check (user_agent is null or char_length(user_agent) <= 400),
  constraint two_factor_session_window check (expires_at > verified_at and expires_at <= verified_at + interval '30 days')
);
create index if not exists two_factor_sessions_user_idx on public.two_factor_sessions (user_id, expires_at desc);
alter table public.two_factor_sessions enable row level security;
drop policy if exists "2fa sessions: own read" on public.two_factor_sessions;
create policy "2fa sessions: own read" on public.two_factor_sessions for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.two_factor_sessions from anon, authenticated;
grant select (session_id, method, verified_at, expires_at) on public.two_factor_sessions to authenticated;

create or replace function public.jwt_session_id()
returns uuid language plpgsql stable as $$
declare v text := coalesce(auth.jwt() ->> 'session_id', '');
begin
  return case when v ~ '^[0-9a-fA-F-]{36}$' then v::uuid else null end;
end $$;

-- True when the caller has not turned 2FA on, or this session passed a code and has not expired.
create or replace function public.two_factor_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then true   -- service role / cron / webhooks
    when not coalesce((select two_factor_enabled from public.profiles where id = auth.uid()), false) then true
    else exists (select 1 from public.two_factor_sessions s
                  where s.user_id = auth.uid() and s.session_id = public.jwt_session_id() and s.expires_at > now())
  end
$$;

-- One round trip for the middleware: ban flag + 2FA state of the current session.
create or replace function public.my_security_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_banned', coalesce(p.is_banned, false),
    'two_factor_enabled', coalesce(p.two_factor_enabled, false),
    'two_factor_ok', public.two_factor_satisfied())
    from public.profiles p where p.id = auth.uid()
$$;

-- Every audited admin action (grants, freezes, kill switch, overrides, View-As, categories)
-- needs a 2FA-verified session when the admin has 2FA on.
create or replace function public.audit_requires_two_factor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.two_factor_satisfied() then
    raise exception 'Verify your two-factor code to continue' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists admin_audit_logs_two_factor on public.admin_audit_logs;
create trigger admin_audit_logs_two_factor before insert on public.admin_audit_logs
  for each row execute function public.audit_requires_two_factor();

-- Money-moving overrides (force release, refunds, landed cost) need 2FA switched ON and verified.
create or replace function public.financial_override_requires_two_factor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not coalesce((select two_factor_enabled from public.profiles where id = auth.uid()), false) then
    raise exception 'Turn on two-factor authentication in Settings before using financial overrides' using errcode = '42501';
  end if;
  if not public.two_factor_satisfied() then
    raise exception 'Verify your two-factor code to continue' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists financial_overrides_two_factor on public.financial_overrides;
create trigger financial_overrides_two_factor before insert on public.financial_overrides
  for each row execute function public.financial_override_requires_two_factor();

-- ── 4. Avatars bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: own upload" on storage.objects;
drop policy if exists "avatars: own update" on storage.objects;
drop policy if exists "avatars: own delete" on storage.objects;
drop policy if exists "avatars: own list" on storage.objects;
create policy "avatars: own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: own list" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 5. Grants ───────────────────────────────────────────────────────────────
revoke all on function public.two_factor_satisfied() from public, anon;
revoke all on function public.my_security_state() from public, anon;
grant execute on function public.two_factor_satisfied() to authenticated;
grant execute on function public.my_security_state() to authenticated;
