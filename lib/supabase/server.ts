import { cache } from 'react';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Profile } from '@/lib/types';
import { parseAdminAccess, roleAdminLevel } from '@/lib/auth/admin-access';

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Runs as the signed-in user, so all RLS policies in schema.sql apply.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/**
 * Returns the verified user + profile, or nulls. Uses getUser() (validated with Supabase Auth), never getSession().
 *
 * Wrapped in React cache(): the root layout (display currency), the page and any nested server
 * component share one auth check and one profile read per request. After auth, the profile and
 * the delegated-admin lookup run in parallel (one round trip instead of two).
 */
export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null } as const;

  const [profile, delegated] = await Promise.all([loadProfile(supabase, user.id), loadDelegatedAccess(supabase)]);
  if (profile) profile.admin_access = adminAccessFor(profile, delegated);
  return { supabase, user, profile } as const;
});

// Newer columns arrive with migrations 016 (avatar, 2FA), 017 (KYC) and 031 (bio); fall back step by step before they exist.
async function loadProfile(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<Profile | null> {
  const base = 'id, role, full_name, company_name, country_code, kyc_verified';
  let profile: Profile | null = null;
  for (const cols of [`${base}, avatar_url, two_factor_enabled, kyc_status, bio`, `${base}, avatar_url, two_factor_enabled, kyc_status`, `${base}, avatar_url, two_factor_enabled`, base]) {
    const { data, error } = await supabase.from('profiles').select(cols).eq('id', userId).single<Profile>();
    profile = data;
    if (!error || !/column|does not exist/i.test(error.message)) break;
  }
  return profile;
}

/**
 * Admin level for the header, nav and page guards. Roles answer directly; anyone
 * else may hold a temporary grant (checked against now() in Postgres). If
 * migration 014 is not applied the RPC errors and nobody is a delegated admin.
 * The grant is fetched alongside the profile, so it is ready whichever role comes back.
 */
async function loadDelegatedAccess(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc('my_admin_access');
  return error ? null : parseAdminAccess(data);
}

function adminAccessFor(profile: Profile, delegated: ReturnType<typeof parseAdminAccess> | null) {
  const level = roleAdminLevel(profile.role);
  return level ? { level } : delegated;
}
