import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { encryptSecret, groupSecret, newTotpSecret, otpauthUri } from '@/lib/security/two-factor';
import { fail, loadTotp, noStore, twoFactorRoute } from '@/lib/security/two-factor-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/2fa/enroll — start (or restart) TOTP setup.
 * → { qr: data:image/png, secret: "ABCD EFGH …", uri } — the secret is shown once for manual entry
 * and stored encrypted, unverified, until /verify confirms a code from the app.
 */
export async function POST() {
  const r = await twoFactorRoute();
  if ('error' in r) return r.error;
  const { ctx, key, db } = r;

  const existing = await loadTotp(db, ctx.user.id);
  if (existing?.is_verified) return fail(409, 'Two-factor authentication is already on. Turn it off first to set up a new device.');

  const secret = newTotpSecret();
  const { error } = await db.from('user_totp_secrets').upsert({
    user_id: ctx.user.id, secret: encryptSecret(secret, ctx.user.id, key), is_verified: false,
    backup_codes: [], last_used_step: null, verified_at: null, created_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) return fail(500, 'Could not start two-factor setup. Please try again.');

  const uri = otpauthUri(secret, ctx.user.email ?? ctx.profile.company_name);
  const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return NextResponse.json({ qr, secret: groupSecret(secret), uri }, { headers: noStore });
}
