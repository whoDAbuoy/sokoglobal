-- =============================================================================
-- SokoGlobal — Migration 031: profile bios + public profiles. Run after 030. Re-runnable.
--
--  * profiles.bio (TEXT, 20–500 characters). Nullable so existing accounts keep working; the app
--    requires it at sign-up and asks existing users to add one (settings save needs it too).
--  * Users may update their own bio (column grant; "profiles: update own" RLS already applies).
--  * handle_new_user() also stores the bio sent with sign-up metadata. Same checks and columns as
--    schema.sql otherwise; a bio outside 20–500 characters is dropped (never blocks the sign-up).
--  * public_profile(id): the safe public fields of a non-banned importer or supplier plus follower,
--    following and live-listing counts, for any signed-in user. Profiles RLS stays as it is
--    (importer rows are still not readable directly); follows still never reveal identities.
-- =============================================================================

alter table public.profiles add column if not exists bio text;
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (bio is null or char_length(bio) between 20 and 500);

grant update (bio) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := new.raw_user_meta_data ->> 'role';
  v_bio  text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'bio', '')), '');
begin
  if v_role not in ('supplier', 'importer') then
    raise exception 'Invalid role "%" at sign-up', v_role;
  end if;
  if v_bio is not null and char_length(v_bio) not between 20 and 500 then
    v_bio := null;
  end if;

  insert into public.profiles (id, role, full_name, company_name, country_code, bio)
  values (
    new.id,
    v_role::public.user_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company_name', ''),
    upper(coalesce(new.raw_user_meta_data ->> 'country_code', 'XX')),
    v_bio
  );
  return new;
end $$;

drop function if exists public.public_profile(uuid);
create function public.public_profile(p_id uuid)
returns table (
  id uuid, role public.user_role, full_name text, company_name text, country_code text, avatar_url text, bio text,
  kyc_verified boolean, created_at timestamptz, follower_count integer, following_count integer, live_listings integer
)
language sql stable security definer set search_path = public as $$
  select p.id, p.role, p.full_name, p.company_name, p.country_code::text, p.avatar_url, p.bio,
         p.kyc_verified, p.created_at,
         (select count(*)::integer from public.follows f where f.following_id = p.id),
         (select count(*)::integer from public.follows f where f.follower_id = p.id),
         (select count(*)::integer from public.products pr where pr.supplier_id = p.id and pr.status = 'live' and pr.deleted_at is null)
    from public.profiles p
   where p.id = p_id
     and p.role in ('importer', 'supplier')
     and not coalesce(p.is_banned, false)
     and auth.uid() is not null
$$;
revoke all on function public.public_profile(uuid) from public, anon;
grant execute on function public.public_profile(uuid) to authenticated;
