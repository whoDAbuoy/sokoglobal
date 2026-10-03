import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import KycWorkspace, { type KycState } from './KycWorkspace';

export const metadata = { title: 'Verification · SokoGlobal' };

/** Supplier KYC: business details, documents (private bucket), payout account. */
export default async function VerificationPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/supplier/verification');
  if (profile.role !== 'supplier') redirect('/dashboard');

  const [kyc, docs, account] = await Promise.all([
    supabase.from('supplier_kyc')
      .select('legal_name, tax_id, registration_number, registered_address, status, review_notes, submitted_at')
      .eq('supplier_id', user.id).maybeSingle(),
    supabase.from('kyc_documents').select('id, doc_type, file_name, storage_path, uploaded_at')
      .eq('supplier_id', user.id).order('uploaded_at'),
    supabase.from('supplier_payout_accounts')
      .select('method, country_code, currency, bank_code, bank_name, account_last4, beneficiary_name, international, verified')
      .eq('supplier_id', user.id).maybeSingle(),
  ]);

  const initial: KycState = {
    kyc: kyc.data ?? null,
    documents: docs.data ?? [],
    account: account.data ?? null,
  };

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Business verification</h1>
        <p className="mt-1 text-sm text-slate-500">
          Verified suppliers get the “KYC verified” badge and automated payouts when buyers confirm delivery.
        </p>
        <div className="mt-6">
          <KycWorkspace userId={user.id} defaultCountry={profile.country_code} initial={initial} />
        </div>
      </main>
    </>
  );
}
