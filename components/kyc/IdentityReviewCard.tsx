'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, Loader2, Undo2 } from 'lucide-react';
import { reviewIdentityDocument } from '@/app/admin/kyc/actions';
import { KYC_LABEL, type KycDocumentType } from '@/lib/kyc';
import { countryName, flag } from '@/lib/format';
import OcrPrecheck, { type OcrResult } from './OcrPrecheck';

export interface IdentityCase {
  id: string; documentType: KycDocumentType; documentNumber: string; submittedAt: string; fileUrl: string | null; fileIsPdf: boolean;
  /** The file's bytes are not the PDF / JPG / PNG it claims (no link is given). */
  fileMismatch: boolean;
  user: { full_name: string; company_name: string; country_code: string; role: string; kyc_status: string; created_at: string } | null;
  /** null before migration 020. */
  ocr: OcrResult | null;
}

/** One document: preview (signed URL, 5 minutes), the number as entered, accept or reject with a note. */
export default function IdentityReviewCard({ item }: { item: IdentityCase }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (approve: boolean) => start(async () => {
    setError(null);
    const res = await reviewIdentityDocument(item.id, approve, note);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message, { description: item.user?.company_name });
    router.refresh();
  });

  return (
    <article className="card grid gap-5 overflow-hidden p-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[14px] bg-neutral-100 ring-1 ring-neutral-200">
        {item.fileUrl && !item.fileIsPdf
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
          ? <img src={item.fileUrl} alt={`${KYC_LABEL[item.documentType]} submitted by ${item.user?.full_name ?? 'the user'}`} className="h-56 w-full object-contain" />
          : <div className="grid h-56 place-items-center text-sm text-neutral-600">{item.fileUrl ? 'PDF document' : item.fileMismatch ? 'Not a real PDF, JPG or PNG: reject and ask for a re-upload' : 'File unavailable'}</div>}
        {item.fileUrl && (
          <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 border-t border-neutral-200 py-2 text-xs font-medium text-blue-700 hover:underline dark:text-cyan-300">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open full size
          </a>
        )}
      </div>
      <div className="min-w-0">
        <p className="eyebrow">{KYC_LABEL[item.documentType]}</p>
        <h3 className="mt-1 text-lg font-semibold text-neutral-900">{item.user?.company_name ?? 'Unknown account'}</h3>
        <p className="text-sm text-neutral-700">{item.user?.full_name} · {item.user ? `${flag(item.user.country_code)} ${countryName(item.user.country_code)}` : ''} · {item.user?.role}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="eyebrow">Document number</dt><dd className="mt-1 font-mono text-neutral-900">{item.documentNumber}</dd></div>
          <div><dt className="eyebrow">Submitted</dt><dd className="mt-1 text-neutral-900">{new Date(item.submittedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
        </dl>
        <OcrPrecheck ocr={item.ocr} />
        <label htmlFor={`note-${item.id}`} className="label mt-4">Note to the user (required to reject)</label>
        <textarea id={`note-${item.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="input"
          placeholder="e.g. The photo is blurred; upload a sharper scan of the photo page." />
        {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => decide(false)} disabled={pending || note.trim().length < 5} className="btn-secondary px-4 py-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />} Reject
          </button>
          <button type="button" onClick={() => decide(true)} disabled={pending || !item.fileUrl} className="btn-primary px-4 py-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Accept document
          </button>
        </div>
      </div>
    </article>
  );
}
