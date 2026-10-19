'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2, PlayCircle, RotateCcw } from 'lucide-react';
import { requeueEvent, resolveIssue, retryWebhooksNow, runReconciliationNow } from '@/app/admin/reconciliation/actions';

export function RunButtons() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<'recon' | 'retry' | null>(null);
  const go = (kind: 'recon' | 'retry') => start(async () => {
    setWhich(kind);
    const r = kind === 'recon' ? await runReconciliationNow() : await retryWebhooksNow();
    (r.ok ? toast.success : toast.error)(r.message);
    router.refresh();
  });
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => go('retry')} disabled={pending} className="btn-secondary py-2">
        {pending && which === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Retry webhooks now
      </button>
      <button type="button" onClick={() => go('recon')} disabled={pending} className="btn-primary py-2">
        {pending && which === 'recon' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />} Run reconciliation
      </button>
    </div>
  );
}

export function ResolveIssue({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="press text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">Resolve</button>;
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await resolveIssue(issueId, text);
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) router.refresh();
    }); }}>
      <label htmlFor={`res-${issueId}`} className="sr-only">Resolution</label>
      <input id={`res-${issueId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="How was it resolved?" className="input w-56 py-1.5 text-xs" />
      <button disabled={pending || text.trim().length < 5} className="btn-primary px-2.5 py-1.5 text-xs">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Save</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-900">Cancel</button>
    </form>
  );
}

export function RequeueEvent({ eventId }: { eventId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
      const r = await requeueEvent(eventId);
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) router.refresh();
    })} className="press inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} Requeue
    </button>
  );
}
