'use client';

import { useActionState, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, PencilLine, XCircle } from 'lucide-react';
import { cancelProfileChange, requestProfileChange, type ProfileChangeState } from '@/app/dashboard/profile/actions';
import type { Profile } from '@/lib/types';

export interface LatestChangeRequest {
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  full_name: string; company_name: string; review_note: string | null; created_at: string; reviewed_at: string | null;
}

/** "Request a change" for name / business name — edits are reviewed by SokoGlobal before they go live. */
export default function ProfileChangeRequest({ profile, latest }: { profile: Profile; latest: LatestChangeRequest | null }) {
  const [state, action, pending] = useActionState<ProfileChangeState, FormData>(requestProfileChange, null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);

  const isPending = latest?.status === 'pending';
  return (
    <div className="-mt-4 space-y-3">
      {isPending && (
        <div className="tone-pending flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm">
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Change awaiting review: <strong>{latest.full_name}</strong> · <strong>{latest.company_name}</strong></span>
          </p>
          <form action={cancelProfileChange}><button className="press text-xs font-medium underline underline-offset-4">Cancel request</button></form>
        </div>
      )}
      {latest?.status === 'rejected' && (
        <p className="tone-danger flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Your last change was not approved{latest.review_note ? `: “${latest.review_note}”` : '.'}</span>
        </p>
      )}
      {latest?.status === 'approved' && latest.reviewed_at && Date.now() - Date.parse(latest.reviewed_at) < 14 * 86_400_000 && (
        <p className="tone-escrow flex items-center gap-2 rounded-lg border px-3.5 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Your profile change was approved.
        </p>
      )}
      {state?.ok && <p role="status" className="tone-escrow rounded-lg border px-3.5 py-3 text-sm">{state.message}</p>}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary px-3 py-2 text-sm">
          <PencilLine className="h-4 w-4" aria-hidden /> {isPending ? 'Replace pending request' : 'Request a change'}
        </button>
      ) : (
        <form action={action} className="card space-y-3 p-4">
          <p className="text-xs text-neutral-600">Changes to your business identity are reviewed by SokoGlobal before they appear to buyers and suppliers.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pc-name" className="label">Contact name</label>
              <input id="pc-name" name="full_name" defaultValue={isPending ? latest.full_name : profile.full_name} required minLength={2} maxLength={120} className="input" />
            </div>
            <div>
              <label htmlFor="pc-company" className="label">Business name</label>
              <input id="pc-company" name="company_name" defaultValue={isPending ? latest.company_name : profile.company_name} required minLength={2} maxLength={160} className="input" />
            </div>
          </div>
          <div>
            <label htmlFor="pc-note" className="label">Reason (optional)</label>
            <textarea id="pc-note" name="note" rows={2} maxLength={500} className="input" placeholder="e.g. Company renamed after registration" />
          </div>
          {state && !state.ok && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-3 py-2 text-sm">Cancel</button>
            <button disabled={pending} className="btn-primary px-3 py-2 text-sm">{pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Send for review</button>
          </div>
        </form>
      )}
    </div>
  );
}
