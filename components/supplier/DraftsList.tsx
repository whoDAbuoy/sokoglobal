'use client';

import { useOptimistic } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Clock, FilePen, ImageIcon, MessageSquareWarning, Undo2 } from 'lucide-react';
import { formatUSD } from '@/lib/format';
import type { ProductCategory } from '@/lib/types';
import ProductVisual from '@/components/dashboard/ProductVisual';
import DeleteDraftButton from './DeleteDraftButton';

export interface DraftItem {
  id: string; title: string; category: ProductCategory; trial_goods_cents: number;
  updated_at: string; review_notes: string | null; image_url: string | null; photo_count: number;
  /** Why it can't be deleted (orders, pools, quotes), from supplier_draft_delete_block(); null = deletable. */
  delete_block: string | null;
}

const MIN_PHOTOS = 3;   // submit_product_for_review() requires 3 photos
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The supplier's drafts with edit and delete; a deleted draft disappears at once (useOptimistic). */
export default function DraftsList({ drafts }: { drafts: DraftItem[] }) {
  const [shown, hide] = useOptimistic(drafts, (list, id: string) => list.filter((d) => d.id !== id));

  if (!shown.length) {
    return (
      <div className="sx-card mt-8 px-6 py-14 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-snow/[0.06]">
          <FilePen className="h-6 w-6 text-neutral-400" aria-hidden />
        </span>
        <p className="mt-3 font-medium text-neutral-900">No drafts</p>
        <p className="mt-1 text-sm text-neutral-600">Listings you start, import, or that reviewers send back appear here until you submit them.</p>
        <Link href="/supplier/products/new" className="btn-secondary mt-4 inline-flex">New product</Link>
      </div>
    );
  }

  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {shown.map((d) => {
        const photosReady = d.photo_count >= MIN_PHOTOS;
        return (
          <li key={d.id} className="sx-card card-lift flex flex-col overflow-hidden p-2">
            <Link href={`/supplier/products/${d.id}`} className="press-card group block">
              <div className="relative">
                <ProductVisual src={d.image_url} alt={d.title} category={d.category} className="aspect-[4/3] rounded-[1.1rem] !bg-[#f4f4f4]" />
                {/* Status pills over the photo: always Draft here; "Returned" when a reviewer sent it back. */}
                <div className="absolute left-3 top-3 flex gap-1.5">
                  <span className="sx-pill bg-[#050505]/75 text-snow backdrop-blur-md"><FilePen className="h-3 w-3" aria-hidden /> Draft</span>
                  {d.review_notes && <span className="sx-pill bg-amber-400 text-[#050505]"><Undo2 className="h-3 w-3" aria-hidden /> Returned</span>}
                </div>
              </div>
              <div className="px-3 pt-3">
                <p className="text-xs capitalize text-neutral-500">{d.category} · edited {day(d.updated_at)}</p>
                <h3 className="mt-0.5 font-medium leading-snug text-neutral-900 group-hover:underline">{d.title}</h3>
              </div>
            </Link>
            <dl className="glass-inset mx-3 mt-3 grid grid-cols-2 divide-x divide-snow/[0.06] rounded-2xl text-sm">
              <div className="px-3 py-2.5"><dt className="text-[11px] uppercase tracking-wider text-neutral-500">Goods value</dt><dd className="mt-0.5 font-semibold tabular-nums text-neutral-900">{formatUSD(d.trial_goods_cents)}</dd></div>
              <div className="px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wider text-neutral-500">Landed cost</dt>
                <dd className="mt-1"><span className="sx-pill sx-pill-blue px-2 py-0.5 text-[11px]"><Clock className="h-3 w-3" aria-hidden /> After review</span></dd>
              </div>
            </dl>
            <ul className="mx-3 mt-3 space-y-1 text-xs text-neutral-600">
              <li className="flex items-center gap-1.5">
                {photosReady ? <CheckCircle2 className="h-3.5 w-3.5 text-[#8fd3cc]" aria-hidden /> : <Circle className="h-3.5 w-3.5 text-neutral-400" aria-hidden />}
                <ImageIcon className="h-3 w-3" aria-hidden /> {d.photo_count} of {MIN_PHOTOS} photos{photosReady ? '' : ' needed to submit'}
              </li>
              <li className="flex items-center gap-1.5">
                <Circle className="h-3.5 w-3.5 text-neutral-400" aria-hidden /> {d.review_notes ? 'Returned by a reviewer' : 'Not submitted for review yet'}
              </li>
            </ul>
            {d.review_notes && (
              <p className="mx-3 mt-2 flex items-start gap-1.5 rounded-2xl border px-2.5 py-2 text-xs tone-pending">
                <MessageSquareWarning className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /><span className="line-clamp-3">{d.review_notes}</span>
              </p>
            )}
            <div className="flex-1" aria-hidden />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-snow/[0.06] px-3 pb-1 pt-3">
              <Link href={`/supplier/products/${d.id}`} className="btn-secondary rounded-full px-3.5 py-1.5 text-sm"><FilePen className="h-4 w-4" aria-hidden /> Edit</Link>
              {d.delete_block
                ? <span className="text-right text-xs text-neutral-500">{d.delete_block}</span>
                : <DeleteDraftButton productId={d.id} title={d.title} onOptimisticRemove={() => hide(d.id)} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
