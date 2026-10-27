import { NextResponse } from 'next/server';
import { generateBackupCodes, hashBackupCode } from '@/lib/security/two-factor';
import { checkSecondFactor, fail, loadTotp, noStore, noteSecondFactorResult, readCodeBody, secondFactorLock, spendSecondFactor, twoFactorRoute } from '@/lib/security/two-factor-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/2fa/backup-codes { code } — replace all backup codes (authenticator code required). */
export async function POST(request: Request) {
  const r = await twoFactorRoute();
  if ('error' in r) return r.error;
  const { ctx, key, db } = r;
  const row = await loadTotp(db, ctx.user.id);
  if (!row?.is_verified) return fail(409, 'Two-factor authentication is not on.');

  const lock = await secondFactorLock(db, ctx.user.id);
  if (lock) return lock;
  const check = await checkSecondFactor(row, await readCodeBody(request), key, false);
  const lockedNow = await noteSecondFactorResult(db, ctx.user.id, check);
  if (lockedNow) return lockedNow;
  if (!check.ok) return fail(400, check.error);
  const codes = generateBackupCodes();
  const won = await spendSecondFactor(db, row, { ...check, patch: { ...check.patch, backup_codes: codes.map((c) => hashBackupCode(c, key)) } });
  if (!won) return fail(409, 'That code was just used. Wait for the next one.');
  return NextResponse.json({ ok: true, backupCodes: codes }, { headers: noStore });
}
