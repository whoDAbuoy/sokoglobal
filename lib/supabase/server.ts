import { cache } from 'react';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Profile } from '@/lib/types';
import type { Database } from '@/lib/supabase/database.types';
import { parseAdminAccess, roleAdminLevel } from '@/lib/auth/admin-access';

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Runs as the signed-in user, so all RLS policies in schema.sql apply.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
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

async function loadProfile(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles')
    .select('id, role, full_name, company_name, country_code, kyc_verified, avatar_url, two_factor_enabled, kyc_status, bio, terms_version')
    .eq('id', userId).maybeSingle();
  if (error) console.error('[session] profile read failed', error.message);
  return data;
}

/**
 * Admin level for the header, nav and page guards. Roles answer directly; anyone
 * else may hold a temporary grant (checked against now() in Postgres). If the
 * RPC errors, nobody is a delegated admin (fails closed).
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
