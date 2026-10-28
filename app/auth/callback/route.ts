import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sameSitePath } from '@/lib/safe-path';

/** Email-confirmation landing: exchanges the one-time code for a session cookie. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const safeNext = sameSitePath(searchParams.get('next')) ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  // A failed reset link gets its own message (the link was for a password reset, not an email confirmation).
  const failure = safeNext.startsWith('/auth/reset-password') ? 'reset_failed' : 'confirmation_failed';
  return NextResponse.redirect(`${origin}/login?error=${failure}`);
}
