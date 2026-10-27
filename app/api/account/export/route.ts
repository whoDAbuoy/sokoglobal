import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/security/rate-limit';
import { EXPORT_ROW_LIMIT, EXPORT_SOURCES, redactRow } from '@/lib/account';
import { LEGAL_VERSION } from '@/lib/legal';

export const dynamic = 'force-dynamic';

/**
 * "Download my data" (Settings → Security, Privacy Policy §9): one JSON file with the account, the profile and
 * every record the account owns. Reads run as the user, so row-level security decides what is included; secret
 * fields (tokens, hashes, bank numbers) are redacted. Uploaded files are listed by path, not embedded.
 */
export async function GET() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const limited = await rateLimit('twofactor', `export:${user.id}`);
  if (!limited.success) return NextResponse.json({ error: 'Too many exports. Wait a minute and try again.' }, { status: 429 });

  const { data: fullProfile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle<Record<string, unknown>>();
  const sections: Record<string, unknown> = {};
  const skipped: string[] = [];
  await Promise.all(EXPORT_SOURCES.map(async ([section, table, column]) => {
    const { data, error } = await supabase.from(table).select('*').eq(column, user.id).limit(EXPORT_ROW_LIMIT);
    if (error) { skipped.push(section); return; }
    sections[section] = (data as Record<string, unknown>[]).map(redactRow);
  }));

  const body = {
    format: 'sokoglobal-account-export/1',
    generated_at: new Date().toISOString(),
    legal_version: LEGAL_VERSION,
    account: {
      id: user.id, email: user.email, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at,
      email_confirmed_at: user.email_confirmed_at ?? null,
    },
    profile: fullProfile ? redactRow(fullProfile) : profile,
    ...Object.fromEntries(Object.keys(sections).sort().map((k) => [k, sections[k]])),
    ...(skipped.length ? { not_included: skipped.sort() } : {}),
  };
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="sokoglobal-data-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
