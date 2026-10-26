import Link from 'next/link';
import clsx from 'clsx';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '@/lib/types';
import { isSuperAdmin } from '@/lib/auth/admin-access';
import { KYC_LABEL, KYC_STATUS_META, type KycDocumentType, type KycStatus } from '@/lib/kyc';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import IdentityReviewCard, { type IdentityCase } from '@/components/kyc/IdentityReviewCard';
import type { OcrResult } from '@/components/kyc/OcrPrecheck';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const PENDING_COLS = 'id, user_id, document_type, document_number, document_url, created_at, user:profiles!kyc_verifications_user_id_fkey ( full_name, company_name, country_code, role, kyc_status, created_at )';
const OCR_COLS = 'ocr_status, ocr_confidence_score, ocr_extracted_data';

/** Pending documents, with the OCR pre-check when migration 020 is applied. */
async function pendingVerifications(supabase: SupabaseClient) {
  const q = (cols: string) => supabase.from('kyc_verifications').select(cols).eq('status', 'pending').order('created_at', { ascending: true }).limit(40)
    .returns<Record<string, unknown>[]>();
  const withOcr = await q(`${PENDING_COLS}, ${OCR_COLS}`);
  return withOcr.error && /column/i.test(withOcr.error.message) ? q(PENDING_COLS) : withOcr;
}

export function KycTabs({ active }: { active: 'suppliers' | 'identity' }) {
  const tab = (id: 'suppliers' | 'identity', label: string, href: string) => (
    <Link href={href} aria-current={active === id ? 'page' : undefined}
      className={clsx('rounded-full border px-3 py-1.5 text-xs font-medium', active === id ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-900')}>
      {label}
    </Link>
  );
  return <nav aria-label="KYC queues" className="mt-3 flex flex-wrap gap-2">{tab('suppliers', 'Supplier business KYC', '/admin/kyc')}{tab('identity', 'Identity verifications', '/admin/kyc?tab=identity')}</nav>;
}

/** Super admin queue for kyc_verifications (identity + business documents from any account). */
export default async function IdentityQueue({ profile, supabase }: { profile: Profile; supabase: SupabaseClient }) {
  const superAdmin = isSuperAdmin(profile);
  const [pendingRes, recentRes] = superAdmin
    ? await Promise.all([
        pendingVerifications(supabase),
        supabase.from('kyc_verifications')
          .select('id, document_type, status, reviewed_at, rejection_reason, user:profiles!kyc_verifications_user_id_fkey ( company_name )')
          .neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(10),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const missing = !!pendingRes.error;
  const pending = pendingRes.data ?? [];
  const signed = pending.length
    ? (await supabase.storage.from('kyc-documents').createSignedUrls(pending.map((p) => p.document_url as string), 300)).data ?? []
    : [];
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const cases: IdentityCase[] = pending.map((p) => ({
    id: p.id as string, documentType: p.document_type as KycDocumentType, documentNumber: p.document_number as string,
    submittedAt: p.created_at as string, fileUrl: urlFor.get(p.document_url as string) ?? null,
    fileIsPdf: String(p.document_url).endsWith('.pdf'),
    user: one(p.user as unknown as IdentityCase['user']),
    ocr: typeof p.ocr_status === 'string'
      ? { status: p.ocr_status as OcrResult['status'], score: p.ocr_confidence_score == null ? null : Number(p.ocr_confidence_score), data: (p.ocr_extracted_data ?? null) as OcrResult['data'] }
      : null,
  }));

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <p className="eyebrow">Internal · Compliance</p>
        <KycTabs active="identity" />
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Identity verifications</h1>
        <p className="mt-1 text-sm text-neutral-600">An account is verified once one identity document and one business document are accepted. Rejections need a note the user will see.</p>

        {!superAdmin ? (
          <p role="note" className="card mt-8 flex items-center gap-3 p-5 text-sm text-neutral-700"><ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden /> Identity documents are reviewed by super admins only.</p>
        ) : missing ? (
          <p role="alert" className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Run <code className="font-mono">supabase/migrations/017_kyc_system.sql</code> to enable identity verification.</p>
        ) : (
          <>
            <section className="mt-8 space-y-5">
              {cases.length === 0 ? (
                <div className="card flex flex-col items-center px-6 py-14 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden />
                  <p className="mt-3 font-medium text-neutral-900">No documents awaiting review</p>
                </div>
              ) : cases.map((c) => <IdentityReviewCard key={c.id} item={c} />)}
            </section>
            <section className="mt-12">
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">Recent decisions</h2>
              <ul className="card mt-4 divide-y divide-neutral-200">
                {(recentRes.data ?? []).length === 0 && <li className="px-5 py-6 text-sm text-neutral-600">None yet.</li>}
                {(recentRes.data ?? []).map((r) => (
                  <li key={r.id as string} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="font-medium text-neutral-900">{one(r.user as unknown as { company_name: string })?.company_name} · {KYC_LABEL[r.document_type as KycDocumentType]}</span>
                    <span className={clsx('pill', KYC_STATUS_META[r.status as KycStatus].tone)}>{r.status === 'approved' ? 'Accepted' : 'Rejected'}{r.reviewed_at ? ` · ${new Date(r.reviewed_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}
