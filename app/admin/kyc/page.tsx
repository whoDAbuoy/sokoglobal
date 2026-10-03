import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, Clock, ShieldCheck, Wallet } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import KycReviewCard, { type KycCase } from './KycReviewCard';

export const metadata = { title: 'Supplier KYC · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL = 300; // seconds — documents are viewable for 5 minutes per page load
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Admin KYC queue. Access: role = 'admin' (404 otherwise). Documents live in
 * the private `kyc-documents` bucket and are exposed only via short-lived
 * signed URLs generated with the admin's own session (storage RLS).
 */
export default async function KycAdminPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/kyc');
  if (profile?.role !== 'admin') notFound();

  const [queueRes, recentRes] = await Promise.all([
    supabase.from('supplier_kyc')
      .select(`supplier_id, legal_name, tax_id, registration_number, registered_address, status, submitted_at, review_notes,
               supplier:profiles!supplier_kyc_supplier_id_fkey ( company_name, full_name, country_code, created_at )`)
      .eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(30),
    supabase.from('supplier_kyc')
      .select('supplier_id, legal_name, status, reviewed_at, supplier:profiles!supplier_kyc_supplier_id_fkey ( company_name )')
      .in('status', ['approved', 'rejected']).order('reviewed_at', { ascending: false }).limit(10),
  ]);
  if (queueRes.error) throw new Error(`Could not load KYC queue: ${queueRes.error.message}`);

  const ids = (queueRes.data ?? []).map((k) => k.supplier_id);
  const [docsRes, acctRes, heldRes, dupRes] = ids.length
    ? await Promise.all([
        supabase.from('kyc_documents').select('id, supplier_id, doc_type, file_name, storage_path, mime_type, bytes, uploaded_at').in('supplier_id', ids),
        supabase.from('supplier_payout_accounts')
          .select('supplier_id, method, country_code, currency, bank_code, bank_name, account_last4, beneficiary_name, international, verified, updated_at')
          .in('supplier_id', ids),
        supabase.from('payouts').select('supplier_id, amount_cents').in('supplier_id', ids).eq('status', 'on_hold'),
        // Same bank account (Vault fingerprint) registered by another supplier → fraud signal.
        supabase.rpc('admin_payout_duplicates', { p_supplier_ids: ids }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const dupFor = new Map(((dupRes.data ?? []) as { supplier_id: string; duplicate_count: number }[]).map((d) => [d.supplier_id, d.duplicate_count]));

  const docs = docsRes.data ?? [];
  const signed = docs.length
    ? (await supabase.storage.from('kyc-documents').createSignedUrls(docs.map((d) => d.storage_path), SIGNED_URL_TTL)).data ?? []
    : [];
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]));

  const cases: KycCase[] = (queueRes.data ?? []).map((k) => {
    const held = (heldRes.data ?? []).filter((h) => h.supplier_id === k.supplier_id);
    return {
      supplierId: k.supplier_id,
      legalName: k.legal_name, taxId: k.tax_id, registrationNumber: k.registration_number, address: k.registered_address,
      submittedAt: k.submitted_at, reviewNotes: k.review_notes,
      supplier: one(k.supplier as unknown as KycCase['supplier']),
      documents: docs.filter((d) => d.supplier_id === k.supplier_id).map((d) => ({
        id: d.id, docType: d.doc_type, fileName: d.file_name, mimeType: d.mime_type, bytes: d.bytes,
        uploadedAt: d.uploaded_at, url: urlFor.get(d.storage_path) ?? null,
      })),
      account: (acctRes.data ?? []).find((a) => a.supplier_id === k.supplier_id) ?? null,
      heldPayouts: { count: held.length, cents: held.reduce((s, h) => s + h.amount_cents, 0) },
      duplicateAccounts: dupFor.get(k.supplier_id) ?? 0,
    };
  });

  const heldTotal = cases.reduce((n, c) => n + c.heldPayouts.count, 0);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Internal · Compliance</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Supplier KYC review</h1>
        <p className="mt-1 text-sm text-slate-500">Check the Tax ID, business registration and director ID against the details provided, then verify the payout account.</p>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Awaiting review', value: cases.length, icon: Clock },
            { label: 'Payouts on hold', value: heldTotal, icon: Wallet },
            { label: 'Decided recently', value: (recentRes.data ?? []).length, icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="card flex items-center gap-4 p-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 ring-1 ring-brand-100"><Icon className="h-5 w-5 text-brand-700" /></span>
              <div><dd className="text-2xl font-semibold tabular-nums">{value}</dd><dt className="text-sm text-slate-500">{label}</dt></div>
            </div>
          ))}
        </dl>

        <section className="mt-8 space-y-5">
          {cases.length === 0 ? (
            <div className="card flex flex-col items-center px-6 py-14 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="mt-3 font-medium">No suppliers awaiting verification</p>
            </div>
          ) : cases.map((c) => <KycReviewCard key={c.supplierId} kyc={c} />)}
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight">Recent decisions</h2>
          <div className="card mt-4 divide-y divide-slate-100">
            {(recentRes.data ?? []).length === 0 && <p className="px-5 py-6 text-sm text-slate-500">None yet.</p>}
            {(recentRes.data ?? []).map((r) => (
              <div key={r.supplier_id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-medium">{one(r.supplier as unknown as { company_name: string })?.company_name ?? r.legal_name}</span>
                <span className={r.status === 'approved' ? 'text-emerald-700' : 'text-red-700'}>
                  {r.status} · {r.reviewed_at && new Date(r.reviewed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
