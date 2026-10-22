import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { MEDIA_BUCKET, UPLOAD_RULES, UUID_RE } from '@/lib/uploads';
import type { MediaType } from '@/lib/types';

/**
 * POST /api/uploads/sign
 * Body: { productId, mediaType, mimeType, size, resumable? }
 * Returns a one-time signed upload URL scoped to {supplierId}/{productId}/{uuid}.{ext}.
 * With resumable: true only the path is returned; the browser then uploads it in TUS
 * chunks with its own session (storage RLS limits suppliers to their own folder).
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile?.role !== 'supplier') return NextResponse.json({ error: 'Supplier account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as
    { productId?: string; mediaType?: MediaType; mimeType?: string; size?: number; resumable?: boolean } | null;
  if (!body?.productId || !UUID_RE.test(body.productId)) return NextResponse.json({ error: 'Invalid product' }, { status: 400 });

  const rules = body.mediaType ? UPLOAD_RULES[body.mediaType] : undefined;
  const ext = rules && body.mimeType ? rules.mimes[body.mimeType] : undefined;
  if (!rules || !ext) return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 });
  if (typeof body.size !== 'number' || body.size <= 0 || body.size > rules.maxBytes) {
    return NextResponse.json({ error: `File is too large (max ${Math.round(rules.maxBytes / 1024 / 1024)} MB)` }, { status: 413 });
  }

  // RLS only returns products this supplier owns.
  const { data: product } = await supabase
    .from('products').select('id, supplier_id, status').eq('id', body.productId).maybeSingle();
  if (!product || product.supplier_id !== user.id) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  if (product.status !== 'draft') return NextResponse.json({ error: 'Media is locked once a product is submitted' }, { status: 409 });

  const path = `${user.id}/${product.id}/${crypto.randomUUID()}.${ext}`;
  if (body.resumable) return NextResponse.json({ path });
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 });

  return NextResponse.json({ signedUrl: data.signedUrl, path: data.path });
}
