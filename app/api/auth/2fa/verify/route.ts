import { NextResponse } from 'next/server';
import { decryptSecret, generateBackupCodes, hashBackupCode, verifyTotp } from '@/lib/security/two-factor';
import { fail, loadTotp, noStore, readCodeBody, recordTwoFactorPass, twoFactorRoute } from '@/lib/security/two-factor-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Unconfirmed setups expire so a QR code left on screen cannot be finished much later. */
const SETUP_TTL_MS = 15 * 60_000;

/**
 * POST /api/auth/2fa/verify { code } — confirm setup with the first code from the app.
 * Only after the server verifies it: is_verified + profiles.two_factor_enabled are set,
 * ten backup codes are issued (returned once, stored hashed) and this session counts as verified.
 */
export async function POST(request: Request) {
  const r = await twoFactorRoute();
  if ('error' in r) return r.error;
  const { ctx, key, db } = r;
  const { code } = await readCodeBody(request);

  const row = await loadTotp(db, ctx.user.id);
  if (!row) return fail(404, 'Start setup first.');
  if (row.is_verified) return fail(409, 'Two-factor authentication is already on.');
  if (Date.now() - Date.parse(row.created_at) > SETUP_TTL_MS) return fail(410, 'This setup expired. Start again to get a new QR code.');

  const check = await verifyTotp(decryptSecret(row.secret, row.user_id, key), code);
  if (!check.valid) return fail(400, 'That code didn’t match. Check your device clock and enter the newest code.');

  const codes = generateBackupCodes();
  const now = new Date().toISOString();
  const { data: updated, error } = await db.from('user_totp_secrets')
    .update({ is_verified: true, verified_at: now, last_used_step: check.timeStep, backup_codes: codes.map((c) => hashBackupCode(c, key)) })
    .eq('user_id', ctx.user.id).eq('is_verified', false).select('user_id');
  if (error || (updated ?? []).length !== 1) return fail(409, 'Setup changed in another tab. Start again.');

  const { error: pErr } = await db.from('profiles').update({ two_factor_enabled: true }).eq('id', ctx.user.id);
  if (pErr) {
    await db.from('user_totp_secrets').update({ is_verified: false, verified_at: null, backup_codes: [] }).eq('user_id', ctx.user.id);
    return fail(500, 'Could not turn on two-factor authentication. Please try again.');
  }
  await recordTwoFactorPass(db, ctx, 'enrolment');
  return NextResponse.json({ ok: true, backupCodes: codes }, { headers: noStore });
}
