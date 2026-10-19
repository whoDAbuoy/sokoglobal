'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2, X } from 'lucide-react';
import { reviewProfileChange } from '@/app/admin/users/actions';
import { profileDiff } from '@/lib/user-admin';
import { initials } from '@/lib/admin-inbox';

export interface ChangeRequest {
  id: string; user_id: string; created_at: string; note: string | null;
  current_full_name: string; current_company_name: string; full_name: string; company_name: string;
  role: string | null;
}

/** One pending profile edit with a field diff and Approve / Reject. */
export default function ChangeRequestCard({ request }: { request: ChangeRequest }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<'approve' | 'reject' | null>(null);

  const act = (approve: boolean) => start(async () => {
    setWhich(approve ? 'approve' : 'reject');
    const res = await reviewProfileChange(request.id, approve, note);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message, { description: request.current_company_name });
    router.refresh();
  });

  return (
    <li className="card card-lift p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-700">{initials(request.current_full_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">{request.current_company_name}</p>
          <p className="text-xs text-neutral-500">{request.role ? `${request.role[0]!.toUpperCase()}${request.role.slice(1)} · ` : ''}requested {new Date(request.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {profileDiff(request).map((d) => (
          <div key={d.field} className={d.changed ? '' : 'opacity-60'}>
            <dt className="text-xs text-neutral-500">{d.field}{!d.changed && ' (unchanged)'}</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {d.changed ? (
                <>
                  <span className="text-neutral-500 line-through">{d.from}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-400" aria-label="changes to" />
                  <span className="font-medium text-neutral-900">{d.to}</span>
                </>
              ) : <span className="text-neutral-700">{d.from}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {request.note && <p className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">“{request.note}”</p>}
      <label htmlFor={`note-${request.id}`} className="sr-only">Review note</label>
      <textarea id={`note-${request.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
        placeholder="Note to the user (required to reject)" className="input mt-3 text-sm" />
      {error && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => act(false)} disabled={pending} className="btn-secondary px-3 py-1.5 text-xs">
          {pending && which === 'reject' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />} Reject
        </button>
        <button type="button" onClick={() => act(true)} disabled={pending} className="btn-primary px-3 py-1.5 text-xs">
          {pending && which === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Approve
        </button>
      </div>
    </li>
  );
}
