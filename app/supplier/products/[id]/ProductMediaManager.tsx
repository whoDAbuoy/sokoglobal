'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Circle, Loader2, Send } from 'lucide-react';
import ImageUpload from '@/components/ImageUpload';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/format';
import type { ProductCategory, ProductMedia, ProductStatus } from '@/lib/types';

/** Wraps ImageUpload with the Visual Proof checklist and "submit for review" action. */
export default function ProductMediaManager({ productId, category, status, initialMedia }: {
  productId: string; category: ProductCategory; status: ProductStatus; initialMedia: ProductMedia[];
}) {
  const router = useRouter();
  const [media, setMedia] = useState(initialMedia);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const images = media.filter((m) => m.media_type === 'image').length;
  const videos = media.filter((m) => m.media_type === 'swatch_video').length;
  const checks = [
    { ok: images >= 3, label: `At least 3 real product photos (${images}/3)` },
    ...(category === 'beauty' ? [{ ok: videos >= 1, label: `Standardized swatch video (${videos}/1)` }] : []),
  ];
  const ready = checks.every((c) => c.ok);

  async function submitForReview() {
    setSubmitting(true);
    setError(null);
    // The same rules are enforced server-side in submit_product_for_review().
    const { error } = await createClient().rpc('submit_product_for_review', { p_product_id: productId });
    setSubmitting(false);
    if (error) return setError(friendlyError(error.message));
    router.push('/supplier');
    router.refresh();
  }

  if (status !== 'draft') {
    return (
      <div className="card p-6 text-sm text-slate-600">
        This product is <strong className="capitalize">{status.replace('_', ' ')}</strong> — media is locked. {media.length} file(s) on record.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <ImageUpload productId={productId} allowVideo onUploaded={(m) => setMedia((prev) => [...prev, m])} />

      <aside className="card h-fit p-5">
        <h3 className="text-sm font-semibold text-slate-900">Review checklist</h3>
        <ul className="mt-3 space-y-2.5">
          {checks.map((c) => (
            <li key={c.label} className={clsx('flex items-start gap-2 text-sm', c.ok ? 'text-emerald-700' : 'text-slate-600')}>
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
              {c.label}
            </li>
          ))}
        </ul>
        {error && <p className="mt-3 flex items-start gap-1.5 text-xs text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />{error}</p>}
        <button type="button" onClick={() => void submitForReview()} disabled={!ready || submitting} className="btn-primary mt-5 w-full">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for review
        </button>
        <p className="mt-3 text-xs text-slate-500">Our team quotes freight & customs and checks photos within 1 business day.</p>
      </aside>
    </div>
  );
}
