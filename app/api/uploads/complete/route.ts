import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/lib/supabase/server';
import { MEDIA_BUCKET, UPLOAD_RULES, UUID_RE } from '@/lib/uploads';
import type { MediaType } from '@/lib/types';

/**
 * POST /api/uploads/complete
 * Body: { productId, path, mediaType, width?, height?, capturedAt? }
 * Verifies the object really exists in storage (size/mime read from storage,
 * not trusted from the client) and records it in product_media.
 */
export async function POST(request: Request) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (profile?.role !== 'supplier') return NextResponse.json({ error: 'Supplier account required' }, { status: 403 });

  const body = await request.json().catch(() => null) as {
    productId?: string; path?: string; mediaType?: MediaType;
    width?: number; height?: number; capturedAt?: string;
  } | null;

  if (!body?.productId || !UUID_RE.test(body.productId) || !body.path || !body.mediaType || !(body.mediaType in UPLOAD_RULES)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const folder = `${user.id}/${body.productId}`;
  const fileName = body.path.slice(folder.length + 1);
  if (!body.path.startsWith(`${folder}/`) || !/^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(fileName)) {
    return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
  }

  const { data: listing, error: listError } = await supabase.storage.from(MEDIA_BUCKET).list(folder, { search: fileName, limit: 1 });
  const object = listing?.find((o) => o.name === fileName);
  if (listError || !object) return NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 });

  const mime: string = object.metadata?.mimetype ?? '';
  const bytes: number = object.metadata?.size ?? 0;
  if (!(mime in UPLOAD_RULES[body.mediaType].mimes)) {
    await supabase.storage.from(MEDIA_BUCKET).remove([body.path]);
    return NextResponse.json({ error: 'File type does not match' }, { status: 415 });
  }

  const { data: { publicUrl } } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(body.path);

  const { count } = await supabase
    .from('product_media').select('id', { count: 'exact', head: true }).eq('product_id', body.productId);

  const capturedAt = body.capturedAt && !Number.isNaN(Date.parse(body.capturedAt)) ? body.capturedAt : null;
  const int = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);

  // RLS ("media: supplier inserts on own draft") re-checks ownership & draft status.
  const { data: media, error } = await supabase
    .from('product_media')
    .insert({
      product_id: body.productId,
      supplier_id: user.id,
      media_type: body.mediaType,
      storage_path: body.path,
      public_url: publicUrl,
      mime_type: mime,
      bytes,
      width: int(body.width),
      height: int(body.height),
      captured_at: capturedAt,
      sort_order: count ?? 0,
    })
    .select('id, product_id, media_type, public_url, storage_path, width, height, created_at')
    .single();

  if (error) {
    await supabase.storage.from(MEDIA_BUCKET).remove([body.path]);
    return NextResponse.json({ error: 'Could not save media' }, { status: 400 });
  }
  return NextResponse.json(media, { status: 201 });
}
