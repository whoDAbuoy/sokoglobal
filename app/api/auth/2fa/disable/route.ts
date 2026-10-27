import { NextResponse } from 'next/server';
import { checkSecondFactor, fail, loadTotp, noStore, noteSecondFactorResult, readCodeBody, secondFactorLock, spendSecondFactor, twoFactorRoute } from '@/lib/security/two-factor-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/2fa/disable { code } | { backupCode } — turning 2FA off needs a current code. */
export async function POST(request: Request) {
  const r = await twoFactorRoute();
  if ('error' in r) return r.error;
  const { ctx, key, db } = r;
  const row = await loadTotp(db, ctx.user.id);
  if (!row) return fail(409, 'Two-factor authentication is not on.');

  if (row.is_verified) {
    const lock = await secondFactorLock(db, ctx.user.id);
    if (lock) return lock;
    const check = await checkSecondFactor(row, await readCodeBody(request), key);
    const lockedNow = await noteSecondFactorResult(db, ctx.user.id, check);
    if (lockedNow) return lockedNow;
    if (!check.ok) return fail(400, check.error);
    if (!(await spendSecondFactor(db, row, check))) return fail(409, 'That code was just used. Wait for the next one.');
  }
  // Unverified (abandoned) setups can be cleared without a code.
  const { error: pErr } = await db.from('profiles').update({ two_factor_enabled: false }).eq('id', ctx.user.id);
  if (pErr) return fail(500, 'Could not turn off two-factor authentication. Please try again.');
  await db.from('user_totp_secrets').delete().eq('user_id', ctx.user.id);
  await db.from('two_factor_sessions').delete().eq('user_id', ctx.user.id);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
