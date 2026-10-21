import Link from 'next/link';
import { ArrowRight, Clock, ShieldAlert } from 'lucide-react';

/**
 * Shown to buyers whose profiles.kyc_status is not 'approved' while KYC is required for orders.
 * `approved` lists document groups already accepted, so a half-verified account is told
 * which document is still missing instead of being asked to start over.
 */
export default function KycBanner({ status, approved = [] }: { status: 'unsubmitted' | 'pending' | 'rejected'; approved?: ('identity' | 'business')[] }) {
  const missing = approved.length === 1 ? (approved[0] === 'identity' ? 'business' : 'identity') : null;
  const copy = status === 'unsubmitted' && missing ? {
    icon: ShieldAlert, title: 'One more document to verify your business',
    body: `Your ${approved[0]} document is approved. Upload ${missing === 'business' ? 'a business licence or tax certificate' : 'a national ID or passport'} to start placing orders.`,
    cta: 'Upload document',
  } : {
    unsubmitted: { icon: ShieldAlert, title: 'Verify your business to place orders', body: 'Upload an ID and a business document. It takes about two minutes.', cta: 'Start verification' },
    pending: { icon: Clock, title: 'Verification in review', body: 'You can browse and save products; ordering opens as soon as we approve your documents.', cta: 'View status' },
    rejected: { icon: ShieldAlert, title: 'A document needs your attention', body: 'One of your verification documents was not accepted. See the note and upload a replacement.', cta: 'Fix documents' },
  }[status];
  const Icon = copy.icon;
  return (
    <div role="status" className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${status === 'pending' ? 'tone-pending' : 'tone-danger'}`}><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{copy.title}</p>
          <p className="text-sm text-neutral-600">{copy.body}</p>
        </div>
      </div>
      <Link href="/dashboard/kyc" className="btn-primary justify-center px-4 py-2 text-sm">{copy.cta} <ArrowRight className="h-4 w-4" aria-hidden /></Link>
    </div>
  );
}
