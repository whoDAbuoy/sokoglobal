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

/** Returns the verified user + profile, or nulls. Uses getUser() (validated with Supabase Auth), never getSession(). */
export async function getSessionProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null } as const;

  // avatar_url / two_factor_enabled arrive with migration 016; before it, fall back to the base columns.
  const base = 'id, role, full_name, company_name, country_code, kyc_verified';
  let { data: profile, error } = await supabase.from('profiles').select(`${base}, avatar_url, two_factor_enabled`).eq('id', user.id).single<Profile>();
  if (error && /avatar_url|two_factor_enabled|column/i.test(error.message)) {
    ({ data: profile } = await supabase.from('profiles').select(base).eq('id', user.id).single<Profile>());
  }

  if (profile) profile.admin_access = await resolveAdminAccess(supabase, profile);
  return { supabase, user, profile } as const;
}

/**
 * Admin level for the header, nav and page guards. Roles answer directly; anyone
 * else may hold a temporary grant (checked against now() in Postgres). If
 * migration 014 is not applied the RPC errors and nobody is a delegated admin.
 */
async function resolveAdminAccess(supabase: Awaited<ReturnType<typeof createClient>>, profile: Profile) {
  const level = roleAdminLevel(profile.role);
  if (level) return { level };
  const { data, error } = await supabase.rpc('my_admin_access');
  return error ? null : parseAdminAccess(data);
}
