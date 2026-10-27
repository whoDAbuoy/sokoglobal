import { NextResponse } from 'next/server';
import { checkSecondFactor, fail, loadTotp, noStore, noteSecondFactorResult, readCodeBody, recordTwoFactorPass, secondFactorLock, spendSecondFactor, twoFactorRoute } from '@/lib/security/two-factor-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/2fa/challenge { code } | { backupCode } — the step after password sign-in.
 * Marks this Supabase session as 2FA-verified (12 h). Rate limited in middleware; wrong codes lock it (secondFactorLock).
 */
export async function POST(request: Request) {
  const r = await twoFactorRoute();
  if ('error' in r) return r.error;
  const { ctx, key, db } = r;
  const row = await loadTotp(db, ctx.user.id);
  if (!row?.is_verified) return fail(409, 'Two-factor authentication is not on for this account.');
  const lock = await secondFactorLock(db, ctx.user.id);
  if (lock) return lock;

  const check = await checkSecondFactor(row, await readCodeBody(request), key);
  const lockedNow = await noteSecondFactorResult(db, ctx.user.id, check);
  if (lockedNow) return lockedNow;
  if (!check.ok) return fail(400, check.error);
  if (!(await spendSecondFactor(db, row, check))) return fail(409, 'That code was just used. Wait for the next one.');
  await recordTwoFactorPass(db, ctx, check.method);
  return NextResponse.json({
    ok: true, method: check.method,
    remainingBackupCodes: check.method === 'backup_code' ? check.patch.backup_codes?.length ?? 0 : row.backup_codes.length,
  }, { headers: noStore });
}
