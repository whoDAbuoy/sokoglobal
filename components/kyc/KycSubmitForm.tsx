'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { KYC_DOCUMENTS, KYC_MIME, normalizeDocumentNumber, verificationPath, type KycDocumentType } from '@/lib/kyc';
import { submitKycDocument, withdrawKycDocument } from '@/app/dashboard/kyc/actions';

/**
 * Upload straight to the private kyc-documents bucket (storage policy: own
 * <uid>/verification/ folder only), then register it for review on the server.
 */
export default function KycSubmitForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [type, setType] = useState<KycDocumentType>('national_id');
  const [number, setNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = KYC_DOCUMENTS.find((d) => d.type === type)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizeDocumentNumber(number)) return setError('Enter the document number as printed (3–40 letters or digits).');
    if (!file) return setError('Choose the document file.');
    const ext = KYC_MIME[file.type];
    if (!ext) return setError('Upload a PDF, JPG or PNG.');
    setBusy(true);
    try {
      const path = verificationPath(userId, crypto.randomUUID(), ext);
      const { error: upErr } = await createClient().storage.from('kyc-documents').upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) return setError('Upload failed. Please try again.');
      const res = await submitKycDocument(type, number, path);
      if (!res.ok) return setError(res.message);
      toast.success(res.message);
      setNumber(''); setFile(null);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-4 p-6" noValidate>
      <h2 className="font-semibold text-neutral-900">Add a document</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="kyc-type" className="label">Document type</label>
          <select id="kyc-type" value={type} onChange={(e) => setType(e.target.value as KycDocumentType)} className="input">
            <optgroup label="Identity">{KYC_DOCUMENTS.filter((d) => d.group === 'identity').map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}</optgroup>
            <optgroup label="Business">{KYC_DOCUMENTS.filter((d) => d.group === 'business').map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}</optgroup>
          </select>
          <p className="mt-1 text-xs text-neutral-600">{meta.hint}</p>
        </div>
        <div>
          <label htmlFor="kyc-number" className="label">Document number</label>
          <input id="kyc-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} autoComplete="off" className="input font-mono uppercase" />
        </div>
      </div>
      <div>
        <label htmlFor="kyc-file" className="label">File (PDF, JPG or PNG)</label>
        <input id="kyc-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm" />
      </div>
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary px-4 py-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} Submit for review
      </button>
    </form>
  );
}

export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
      const res = await withdrawKycDocument(id);
      (res.ok ? toast.success : toast.error)(res.message);
      if (res.ok) router.refresh();
    })} className="text-xs font-medium text-neutral-600 underline underline-offset-4 hover:text-neutral-900">
      {pending ? 'Withdrawing…' : 'Withdraw'}
    </button>
  );
}
