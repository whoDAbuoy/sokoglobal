import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | undefined;

/**
 * Service-role Supabase client — BYPASSES RLS. Server-only (the `server-only`
 * import makes any client-bundle import a build error).
 *
 * Built with @supabase/ssr but deliberately wired to an EMPTY cookie store:
 * if it read the request's cookies it would pick up a signed-in user's JWT and
 * silently run as that user instead of as the service role.
 *
 * Use only after the caller is authenticated by other means (e.g. a verified
 * webhook signature). Never pass user input into it unchecked.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  adminClient ??= createServerClient(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}
