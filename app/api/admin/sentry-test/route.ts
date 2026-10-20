import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sentry-test — admins only. Throws on purpose so you can confirm
 * Sentry receives server errors (it should appear as "SokoGlobal Sentry test event"
 * in the project's Issues within a minute). Everyone else gets a 404.
 */
export async function GET() {
  const { user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'admin') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  throw new Error(`SokoGlobal Sentry test event (${new Date().toISOString()})`);
}
