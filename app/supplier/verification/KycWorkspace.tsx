'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  AlertCircle, BadgeCheck, Building2, CheckCircle2, Clock, FileText, Landmark, Loader2, Send, Trash2, Upload, XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/format';

type DocType = 'tax_certificate' | 'business_registration' | 'identity';
type Status = 'not_started' | 'submitted' | 'approved' | 'rejected';

export interface KycState {
  kyc: { legal_name: string | null; tax_id: string | null; registration_number: string | null; registered_address: string | null;
         status: Status; review_notes: string | null; submitted_at: string | null } | null;
  documents: { id: string; doc_type: DocType; file_name: string; storage_path: string; uploaded_at: string }[];
  account: { method: 'bank' | 'mobile_money'; country_code: string; currency: string; bank_code: string; bank_name: string | null;
             account_last4: string | null; beneficiary_name: string; international: Record<string, string>; verified: boolean } | null;
}

const DOCS: { type: DocType; label: string; hint: string }[] = [
  { type: 'tax_certificate', label: 'Tax ID certificate', hint: 'EIN letter, VAT/UTR certificate or equivalent' },
  { type: 'business_registration', label: 'Business registration', hint: 'Certificate of incorporation / company registry extract' },
  { type: 'identity', label: 'Director ID', hint: 'Passport or national ID of a director or owner' },
];
const DOC_MIMES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const BUCKET = 'kyc-documents';

export default function KycWorkspace({ userId, defaultCountry, initial }: { userId: string; defaultCountry: string; initial: KycState }) {
  const router = useRouter();
  const supabase = createClient();
  const status: Status = initial.kyc?.status ?? 'not_started';
  const editable = status === 'not_started' || status === 'rejected';

  const [docs, setDocs] = useState(initial.documents);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submitForReview() {
    setSubmitting(true); setSubmitError(null);
    const { error } = await supabase.rpc('submit_kyc');
    setSubmitting(false);
    if (error) return setSubmitError(friendlyError(error.message));
    router.refresh();
  }

  const docsComplete = DOCS.every((d) => docs.some((x) => x.doc_type === d.type));

  return (
    <div className="space-y-6">
      <StatusBanner status={status} notes={initial.kyc?.review_notes ?? null} />

      <BusinessDetails userId={userId} initial={initial.kyc} editable={editable} />

      <section className="card p-6">
        <SectionTitle icon={FileText} title="Documents" subtitle="PDF, JPG or PNG up to 10 MB. Stored privately — only our compliance team can view them." />
        <ul className="mt-5 space-y-4">
          {DOCS.map((d) => (
            <DocumentSlot key={d.type} userId={userId} spec={d} editable={editable}
              files={docs.filter((x) => x.doc_type === d.type)}
              onAdded={(row) => setDocs((prev) => [...prev, row])}
              onRemoved={(id) => setDocs((prev) => prev.filter((x) => x.id !== id))} />
          ))}
        </ul>
      </section>

      <PayoutAccountForm userId={userId} defaultCountry={defaultCountry} initial={initial.account} kycStatus={status} />

      {editable && (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="font-medium text-slate-900">Ready to submit?</p>
            <p className="text-sm text-slate-500">Review usually takes 1–2 business days.</p>
          </div>
          <button type="button" onClick={() => void submitForReview()} disabled={submitting || !docsComplete} className="btn-primary"
            title={docsComplete ? undefined : 'Upload all three documents first'}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for verification
          </button>
          {submitError && <p role="alert" className="flex w-full items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{submitError}</p>}
        </div>
      )}
    </div>
  );
}

function StatusBanner({ status, notes }: { status: Status; notes: string | null }) {
  const map = {
    not_started: { icon: Clock, cls: 'bg-slate-50 text-slate-700 ring-slate-200', title: 'Not yet verified', body: 'Complete the three steps below and submit.' },
    submitted: { icon: Clock, cls: 'bg-amber-50 text-amber-900 ring-amber-600/20', title: 'Under review', body: notes ?? 'Our compliance team is reviewing your documents.' },
    approved: { icon: BadgeCheck, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20', title: 'Verified business', body: 'Payouts are sent automatically when buyers confirm delivery.' },
    rejected: { icon: XCircle, cls: 'bg-red-50 text-red-800 ring-red-600/20', title: 'Changes needed', body: notes ?? 'Please update your details and resubmit.' },
  }[status];
  const Icon = map.icon;
  return (
    <div role="status" className={clsx('flex gap-3 rounded-xl p-4 ring-1', map.cls)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div><p className="font-semibold">{map.title}</p><p className="mt-0.5 whitespace-pre-line text-sm">{map.body}</p></div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof FileText; title: string; subtitle: string }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 ring-1 ring-brand-100"><Icon className="h-4 w-4 text-brand-700" aria-hidden /></span>
      <div><h2 className="font-semibold text-slate-900">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div>
    </div>
  );
}

function SaveRow({ saving, saved, error, disabled }: { saving: boolean; saved: boolean; error: string | null; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
      {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />{error}</p>}
      {saved && !error && <p className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Saved</p>}
      <button type="submit" disabled={saving || disabled} className="btn-secondary">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
    </div>
  );
}

/* ---------------------------------- Step 1 ---------------------------------- */
function BusinessDetails({ userId, initial, editable }: { userId: string; initial: KycState['kyc']; editable: boolean }) {
  const supabase = createClient();
  const [form, setForm] = useState({
    legal_name: initial?.legal_name ?? '', tax_id: initial?.tax_id ?? '',
    registration_number: initial?.registration_number ?? '', registered_address: initial?.registered_address ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })); };

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const values = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    // Insert the first time; afterwards update (RLS only allows edits before submission).
    const { error } = initial
      ? await supabase.from('supplier_kyc').update(values).eq('supplier_id', userId)
      : await supabase.from('supplier_kyc').insert({ supplier_id: userId, ...values });
    setSaving(false);
    if (error) return setError(friendlyError(error.message));
    setSaved(true);
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-6">
      <SectionTitle icon={Building2} title="Business details" subtitle="Exactly as shown on your registration documents." />
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label" htmlFor="legal">Registered legal name</label>
          <input id="legal" required minLength={2} maxLength={200} className="input" value={form.legal_name} onChange={set('legal_name')} /></div>
        <div><label className="label" htmlFor="tax">Tax ID (EIN / VAT / UTR)</label>
          <input id="tax" required minLength={3} maxLength={64} className="input" value={form.tax_id} onChange={set('tax_id')} /></div>
        <div><label className="label" htmlFor="reg">Company registration no.</label>
          <input id="reg" required minLength={3} maxLength={64} className="input" value={form.registration_number} onChange={set('registration_number')} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="addr">Registered address</label>
          <textarea id="addr" rows={2} maxLength={500} className="input" value={form.registered_address} onChange={set('registered_address')} /></div>
      </fieldset>
      {editable && <SaveRow saving={saving} saved={saved} error={error} />}
    </form>
  );
}

/* ---------------------------------- Step 2 ---------------------------------- */
function DocumentSlot({ userId, spec, files, editable, onAdded, onRemoved }: {
  userId: string; spec: (typeof DOCS)[number]; files: KycState['documents']; editable: boolean;
  onAdded: (row: KycState['documents'][number]) => void; onRemoved: (id: string) => void;
}) {
  const supabase = createClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const ext = DOC_MIMES[file.type];
    if (!ext) return setError('Upload a PDF, JPG or PNG');
    if (file.size > MAX_DOC_BYTES) return setError('File is larger than 10 MB');
    setBusy(true);
    // Storage RLS: suppliers may only write under their own {uid}/ folder.
    const path = `${userId}/${spec.type}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { setBusy(false); return setError('Upload failed — please try again'); }
    const { data, error: rowErr } = await supabase.from('kyc_documents')
      .insert({ supplier_id: userId, doc_type: spec.type, storage_path: path, file_name: file.name.slice(0, 255), mime_type: file.type, bytes: file.size })
      .select('id, doc_type, file_name, storage_path, uploaded_at').single();
    setBusy(false);
    if (rowErr || !data) { await supabase.storage.from(BUCKET).remove([path]); return setError(friendlyError(rowErr?.message)); }
    onAdded(data as KycState['documents'][number]);
  }

  async function remove(doc: KycState['documents'][number]) {
    setBusy(true);
    const { error: delErr } = await supabase.from('kyc_documents').delete().eq('id', doc.id);
    if (!delErr) { await supabase.storage.from(BUCKET).remove([doc.storage_path]); onRemoved(doc.id); }
    else setError(friendlyError(delErr.message));
    setBusy(false);
  }

  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
            {files.length > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Uploaded" /> : <span className="h-4 w-4 rounded-full border-2 border-slate-300" aria-hidden />}
            {spec.label}
          </p>
          <p className="mt-0.5 pl-[22px] text-xs text-slate-500">{spec.hint}</p>
        </div>
        {editable && (
          <>
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-secondary py-1.5 text-xs">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </button>
            <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden"
              aria-label={`Upload ${spec.label}`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </>
        )}
      </div>
      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5 pl-[22px]">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
              <span className="truncate">{f.file_name}</span>
              {editable && (
                <button type="button" onClick={() => void remove(f)} disabled={busy} aria-label={`Remove ${f.file_name}`} className="rounded p-1 text-slate-400 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 pl-[22px] text-xs text-red-600">{error}</p>}
    </li>
  );
}

/* ---------------------------------- Step 3 ---------------------------------- */
// Must match supported_payout_currencies() in migration 004.
const CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS', 'ZAR', 'UGX', 'TZS', 'RWF', 'XOF', 'XAF', 'EGP', 'MAD', 'ZMW'];

function PayoutAccountForm({ userId, defaultCountry, initial, kycStatus }: {
  userId: string; defaultCountry: string; initial: KycState['account']; kycStatus: Status;
}) {
  const supabase = createClient();
  const [f, setF] = useState({
    method: initial?.method ?? 'bank', country_code: initial?.country_code ?? defaultCountry, currency: initial?.currency ?? 'USD',
    bank_code: initial?.bank_code ?? '', bank_name: initial?.bank_name ?? '', account_number: '',   // never sent back to the browser
    beneficiary_name: initial?.beneficiary_name ?? '',
    routing_number: initial?.international?.routing_number ?? '', swift_code: initial?.international?.swift_code ?? '',
    beneficiary_address: initial?.international?.beneficiary_address ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF((s) => ({ ...s, [k]: e.target.value })); };
  const international = f.method === 'bank' && ['USD', 'EUR', 'GBP'].includes(f.currency);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const accountNumber = f.account_number.replace(/\s/g, '');
    if (!initial && !accountNumber) return setError('Enter your account number / IBAN / phone number');
    if (accountNumber && !/^[A-Za-z0-9+]{4,34}$/.test(accountNumber)) return setError('Enter a valid account number / IBAN / phone number');
    if (kycStatus === 'approved' && !confirm('Changing your payout account pauses payouts until our team re-verifies it. Continue?')) return;
    setSaving(true);
    // Encrypted server-side into Supabase Vault; the table never stores the plaintext.
    const { error } = await supabase.rpc('upsert_payout_account', {
      p_method: f.method,
      p_country_code: f.country_code.toUpperCase().slice(0, 2),
      p_currency: f.currency,
      p_bank_code: f.bank_code.trim(),
      p_bank_name: f.bank_name.trim() || null,
      p_account_number: accountNumber || null,     // null = keep the number already on file
      p_beneficiary_name: f.beneficiary_name.trim(),
      p_international: international
        ? Object.fromEntries(Object.entries({ routing_number: f.routing_number, swift_code: f.swift_code, beneficiary_address: f.beneficiary_address })
            .map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
        : {},
    });
    if (!error) setF((s) => ({ ...s, account_number: '' }));
    setSaving(false);
    if (error) return setError(friendlyError(error.message));
    setSaved(true);
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-6">
      <SectionTitle icon={Landmark} title="Payout account" subtitle="Where we send your money when buyers confirm delivery." />
      {initial && (
        <p className={clsx('text-xs font-medium', initial.verified ? 'text-emerald-700' : 'text-amber-700')}>
          {initial.verified ? '✓ Verified by SokoGlobal' : 'Awaiting verification by SokoGlobal'}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div><label className="label" htmlFor="method">Type</label>
          <select id="method" className="input" value={f.method} onChange={set('method')}>
            <option value="bank">Bank account</option><option value="mobile_money">Mobile money</option>
          </select></div>
        <div><label className="label" htmlFor="pcountry">Country (ISO)</label>
          <input id="pcountry" required maxLength={2} className="input uppercase" value={f.country_code} onChange={set('country_code')} /></div>
        <div><label className="label" htmlFor="pcur">Currency</label>
          <select id="pcur" className="input" value={f.currency} onChange={set('currency')}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="bname">{f.method === 'bank' ? 'Bank name' : 'Network'}</label>
          <input id="bname" className="input" value={f.bank_name} onChange={set('bank_name')} placeholder={f.method === 'bank' ? 'e.g. Barclays' : 'e.g. M-Pesa'} /></div>
        <div><label className="label" htmlFor="bcode">{f.method === 'bank' ? 'Bank code' : 'Network code'}</label>
          <input id="bcode" required className="input" value={f.bank_code} onChange={set('bank_code')} placeholder={f.method === 'bank' ? 'Flutterwave bank code' : 'e.g. MPS'} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="acct">{f.method === 'bank' ? 'Account number / IBAN' : 'Phone number (with country code)'}</label>
          <input id="acct" required={!initial} autoComplete="off" spellCheck={false} className="input font-mono" value={f.account_number} onChange={set('account_number')}
            placeholder={initial?.account_last4 ? `On file: •••• ${initial.account_last4} — re-enter to change` : ''} />
          <p className="mt-1 text-[11px] text-slate-500">Encrypted with Supabase Vault. Only the last 4 digits are ever shown.</p></div>
        <div><label className="label" htmlFor="benef">Account holder</label>
          <input id="benef" required className="input" value={f.beneficiary_name} onChange={set('beneficiary_name')} /></div>
        {international && (
          <>
            <div><label className="label" htmlFor="routing">Routing / sort code</label>
              <input id="routing" className="input" value={f.routing_number} onChange={set('routing_number')} /></div>
            <div><label className="label" htmlFor="swift">SWIFT / BIC</label>
              <input id="swift" className="input uppercase" value={f.swift_code} onChange={set('swift_code')} /></div>
            <div className="sm:col-span-3"><label className="label" htmlFor="baddr">Account holder address</label>
              <input id="baddr" className="input" value={f.beneficiary_address} onChange={set('beneficiary_address')} /></div>
          </>
        )}
      </div>
      {f.currency !== 'USD' && (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Orders settle in USD. Payouts to {f.currency} accounts are converted automatically at Flutterwave&apos;s transfer rate on the day of release.
        </p>
      )}
      <SaveRow saving={saving} saved={saved} error={error} />
    </form>
  );
}
