import { redirect } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { CheckCircle2, Clock, FileText, ShieldCheck, XCircle } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { KYC_LABEL, KYC_STATUS_META, checklist, maskDocumentNumber, parseKycStatus, type KycDocumentType, type KycStatus } from '@/lib/kyc';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import KycSubmitForm, { WithdrawButton } from '@/components/kyc/KycSubmitForm';
import { safeReturnPath } from '@/lib/security/two-factor-gate';

export const metadata = { title: 'Verification · SokoGlobal', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;   // the submit action runs the OCR pre-check after responding

interface Row { id: string; document_type: KycDocumentType; document_number: string; document_url: string; status: KycStatus; rejection_reason: string | null; created_at: string; reviewed_at: string | null }

/** Identity & business verification for importers (suppliers use /supplier/verification). */
export default async function KycPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/kyc');
  if (profile.role === 'supplier') redirect('/supplier/verification');
  const { next } = await searchParams;

  const [{ data: me }, rowsRes] = await Promise.all([
    supabase.from('profiles').select('kyc_status, kyc_verified_at').eq('id', user.id).maybeSingle<{ kyc_status: string; kyc_verified_at: string | null }>(),
    supabase.from('kyc_verifications').select('id, document_type, document_number, document_url, status, rejection_reason, created_at, reviewed_at')
      .order('created_at', { ascending: false }).limit(20),
  ]);
  const ready = !rowsRes.error;
  const rows = (rowsRes.data ?? []) as Row[];
  const status = parseKycStatus(me?.kyc_status) ?? 'unsubmitted';
  const list = checklist(rows);
  const signed = rows.length
    ? (await supabase.storage.from('kyc-documents').createSignedUrls(rows.map((r) => r.document_url), 300)).data ?? []
    : [];
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const back = next ? safeReturnPath(next, '/dashboard') : null;

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="eyebrow">Account</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-neutral-900">Verification</h1>
          <span className={clsx('pill', KYC_STATUS_META[status].tone)}>{KYC_STATUS_META[status].label}</span>
        </div>
        <p className="mt-2 text-sm text-neutral-600">
          SokoGlobal verifies every business before it can place escrow orders. Upload one identity document and one business document;
          files are stored privately and only our compliance team can open them.
        </p>

        {!ready && (
          <p role="note" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Verification opens once the latest database update (migration 017) is applied.</p>
        )}

        {status === 'approved' ? (
          <section className="card mt-8 flex items-start gap-4 p-6">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border tone-escrow"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
            <div>
              <h2 className="font-semibold text-neutral-900">Your business is verified</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Verified {me?.kyc_verified_at ? new Date(me.kyc_verified_at).toLocaleDateString('en-GB', { dateStyle: 'long' }) : ''}. You can place escrow orders and join Trend Pools.
              </p>
              {back && <Link href={back} className="btn-primary mt-4 inline-flex px-4 py-2">Continue</Link>}
            </div>
          </section>
        ) : (
          <>
            <section aria-label="Checklist" className="mt-8 grid gap-3 sm:grid-cols-2">
              {([['identity', 'Identity document', 'National ID or passport'], ['business', 'Business document', 'Business licence or tax certificate']] as const).map(([k, label, hint]) => {
                const s = list[k];
                const Icon = s === 'approved' ? CheckCircle2 : s === 'pending' ? Clock : s === 'rejected' ? XCircle : FileText;
                return (
                  <div key={k} className="card flex items-start gap-3 p-4">
                    <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-lg border', KYC_STATUS_META[s].tone)}><Icon className="h-4 w-4" aria-hidden /></span>
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{label}</p>
                      <p className="text-xs text-neutral-600">{s === 'unsubmitted' ? hint : KYC_STATUS_META[s].label}</p>
                    </div>
                  </div>
                );
              })}
            </section>
            {ready && <KycSubmitForm userId={user.id} />}
          </>
        )}

        {rows.length > 0 && (
          <section aria-labelledby="submitted" className="card mt-8 overflow-hidden">
            <h2 id="submitted" className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-900">Your documents</h2>
            <ul className="divide-y divide-neutral-200">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">{KYC_LABEL[r.document_type]} <span className="font-mono text-xs text-neutral-600">{maskDocumentNumber(r.document_number)}</span></p>
                    <p className="text-xs text-neutral-600">Submitted {new Date(r.created_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                      {urlFor.get(r.document_url) && <> · <a href={urlFor.get(r.document_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">View file</a></>}</p>
                    {r.status === 'rejected' && r.rejection_reason && <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">Not accepted: {r.rejection_reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('pill', KYC_STATUS_META[r.status].tone)}>{r.status === 'approved' ? 'Accepted' : KYC_STATUS_META[r.status].label}</span>
                    {r.status === 'pending' && <WithdrawButton id={r.id} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
