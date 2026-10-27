import 'server-only';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestFingerprint } from '@/lib/auth/admin-access';
import { NextResponse } from 'next/server';
import {
  consumeBackupCode, decryptSecret, isBackupCodeFormat, isTotpFormat, sessionClaims, twoFactorKey, twoFactorSessionExpiry, verifyTotp,
  TwoFactorConfigError,
} from '@/lib/security/two-factor';

export interface TotpRow { user_id: string; secret: string; is_verified: boolean; backup_codes: string[]; last_used_step: number | null; verified_at: string | null; created_at: string }

/**
 * Signed-in user + the Supabase session id from their (already validated) access
 * token. The session id is what a 2FA pass is bound to: a fresh sign-in gets a
 * new id and must pass the code again.
 */
export async function twoFactorContext() {
  const ctx = await getSessionProfile();
  if (!ctx.user || !ctx.profile) return null;
  const { data: { session } } = await ctx.supabase.auth.getSession();
  const claims = sessionClaims(session?.access_token);
  if (!claims || claims.sub !== ctx.user.id) return null;
  return { ...ctx, user: ctx.user, profile: ctx.profile, sessionId: claims.sessionId, fp: requestFingerprint(await headers()) };
}
export type TwoFactorContext = NonNullable<Awaited<ReturnType<typeof twoFactorContext>>>;

/** Service-role client: secrets are never readable or writable from the browser (migration 016 grants). */
export const totpDb = (): SupabaseClient => createAdminClient();

export async function loadTotp(db: SupabaseClient, userId: string): Promise<TotpRow | null> {
  const { data, error } = await db.from('user_totp_secrets')
    .select('user_id, secret, is_verified, backup_codes, last_used_step, verified_at, created_at').eq('user_id', userId).maybeSingle<TotpRow>();
  if (error) throw new Error(`Could not read two-factor settings: ${error.message}`);
  return data;
}

/** Marks the current Supabase session as 2FA-verified for TWO_FACTOR_SESSION_HOURS. */
export async function recordTwoFactorPass(db: SupabaseClient, ctx: TwoFactorContext, method: 'totp' | 'backup_code' | 'enrolment') {
  const { error } = await db.from('two_factor_sessions').upsert({
    session_id: ctx.sessionId, user_id: ctx.user.id, method, verified_at: new Date().toISOString(),
    expires_at: twoFactorSessionExpiry(), ip: ctx.fp.ip, user_agent: ctx.fp.ua,
  }, { onConflict: 'session_id' });
  if (error) throw new Error(`Could not record the two-factor check: ${error.message}`);
}

/** { enabled, ok } for the current session. A failed read throws: it must never pass for "2FA satisfied". */
export async function twoFactorState(supabase: SupabaseClient<Database>): Promise<{ enabled: boolean; ok: boolean }> {
  const { data, error } = await supabase.rpc('my_security_state');
  if (error || !data) throw new Error(`Could not read the two-factor state: ${error?.message ?? 'no profile'}`);
  const s = data as { two_factor_enabled?: boolean; two_factor_ok?: boolean };
  return { enabled: !!s.two_factor_enabled, ok: s.two_factor_ok === true };
}

export const noStore = { 'Cache-Control': 'no-store' };
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore });

/** Parsed { code?, backupCode? } from a small JSON body. */
export async function readCodeBody(request: Request): Promise<{ code: string; backupCode: string }> {
  const raw = await request.text().catch(() => '');
  if (raw.length > 2_000) return { code: '', backupCode: '' };
  let b: { code?: unknown; backupCode?: unknown } = {};
  try { b = JSON.parse(raw || '{}'); } catch { /* empty */ }
  return { code: typeof b.code === 'string' ? b.code : '', backupCode: typeof b.backupCode === 'string' ? b.backupCode : '' };
}

/** Shared start of every 2FA route: session + key + service client, or an error response. */
export async function twoFactorRoute() {
  const ctx = await twoFactorContext();
  if (!ctx) return { error: fail(401, 'Sign in first.') } as const;
  let key: Buffer;
  try { key = twoFactorKey(); } catch (e) {
    console.error('[2fa]', e instanceof TwoFactorConfigError ? e.message : e);
    return { error: fail(503, 'Two-factor authentication is not available yet. Please try again later.') } as const;
  }
  let db: SupabaseClient;
  try { db = totpDb(); } catch { return { error: fail(503, 'Two-factor authentication is not available yet. Please try again later.') } as const; }
  return { ctx, key, db } as const;
}

export type SecondFactor =
  | { ok: true; method: 'totp' | 'backup_code'; patch: Partial<Pick<TotpRow, 'last_used_step' | 'backup_codes'>> }
  /** `wrong`: a well-formed code that did not match (counts towards the lockout; typos in the format do not). */
  | { ok: false; error: string; wrong?: true };

/**
 * Checks an authenticator code (with replay guard) or a single-use backup code against
 * a verified enrolment, and returns the row update that "spends" it. The caller writes
 * the patch before trusting the result, so a code cannot be used twice concurrently.
 */
export async function checkSecondFactor(row: TotpRow, input: { code: string; backupCode: string }, key: Buffer, allowBackup = true): Promise<SecondFactor> {
  if (input.code) {
    if (!isTotpFormat(input.code)) return { ok: false, error: 'Enter the 6-digit code from your authenticator app.' };
    const secret = decryptSecret(row.secret, row.user_id, key);
    const r = await verifyTotp(secret, input.code, row.last_used_step);
    return r.valid ? { ok: true, method: 'totp', patch: { last_used_step: r.timeStep } } : { ok: false, wrong: true, error: 'That code didn’t match. Check your device clock and try the newest code.' };
  }
  if (allowBackup && input.backupCode) {
    if (!isBackupCodeFormat(input.backupCode)) return { ok: false, error: 'Backup codes look like ABCD-EFGH.' };
    const left = consumeBackupCode(row.backup_codes, input.backupCode, key);
    return left ? { ok: true, method: 'backup_code', patch: { backup_codes: left } } : { ok: false, wrong: true, error: 'That backup code is not valid or was already used.' };
  }
  return { ok: false, error: allowBackup ? 'Enter a code from your authenticator app or a backup code.' : 'Enter the 6-digit code from your authenticator app.' };
}

/**
 * Applies the patch only if the row still holds the values we checked against
 * (optimistic concurrency): two requests racing with the same code cannot both win.
 */
export async function spendSecondFactor(db: SupabaseClient, row: TotpRow, patch: SecondFactor & { ok: true }): Promise<boolean> {
  let q = db.from('user_totp_secrets').update(patch.patch).eq('user_id', row.user_id);
  q = row.last_used_step === null ? q.is('last_used_step', null) : q.eq('last_used_step', row.last_used_step);
  q = q.eq('backup_codes', `{${row.backup_codes.join(',')}}`);
  const { data, error } = await q.select('user_id');
  if (error) throw new Error(`Could not record the code: ${error.message}`);
  return (data ?? []).length === 1;
}

const lockedMessage = (until: Date) =>
  `Too many wrong codes. Try again after ${until.toISOString().slice(11, 16)} UTC.`;
const locked = (until: Date) => NextResponse.json({ error: lockedMessage(until), lockedUntil: until.toISOString() }, {
  status: 429, headers: { ...noStore, 'Retry-After': String(Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000))) },
});

/**
 * Wrong-code lockout (migration 041), on top of the per-minute rate limit: every 5th consecutive wrong
 * code locks the challenge for 15 minutes, doubling up to 24 hours. Checked before any code is compared,
 * so a locked account learns nothing from further guesses. Returns the 429 response while locked.
 */
export async function secondFactorLock(db: SupabaseClient, userId: string): Promise<NextResponse | null> {
  const { data, error } = await db.rpc('two_factor_locked_until', { p_user: userId });
  if (error) throw new Error(`Could not read the two-factor lock: ${error.message}`);
  return typeof data === 'string' ? locked(new Date(data)) : null;
}

/** Records the outcome of a code check: clears the count on success, counts a wrong code (→ 429 once it locks). */
export async function noteSecondFactorResult(db: SupabaseClient, userId: string, check: SecondFactor): Promise<NextResponse | null> {
  if (check.ok) {
    const { error } = await db.rpc('clear_two_factor_failures', { p_user: userId });
    if (error) console.error('[2fa] could not clear the failure count', error.message);
    return null;
  }
  if (!check.wrong) return null;
  const { data, error } = await db.rpc('record_two_factor_failure', { p_user: userId });
  if (error) throw new Error(`Could not record the failed code: ${error.message}`);
  return typeof data === 'string' ? locked(new Date(data)) : null;
}
