'use client';

import { useRef, useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import clsx from 'clsx';
import { replyToTicket } from '@/app/admin/support/actions';
import { useMutedTickets } from './useMutedTickets';

/** Reply drawer: textarea, "Mute this thread" switch and Send. Posts through the existing replyToTicket action. */
export default function ReplyBox({ ticketId, customerName, disabled }: { ticketId: string; customerName: string; disabled?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const { isMuted, setMutedFor } = useMutedTickets();
  const muted = isMuted(ticketId);

  const submit = (fd: FormData) => {
    if (!body.trim()) return;
    startTransition(async () => {
      await replyToTicket(fd);
      setBody('');
      formRef.current?.reset();
    });
  };

  return (
    <form ref={formRef} action={submit} className="sticky bottom-0 border-t border-neutral-200 bg-white p-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 focus-within:border-neutral-400">
        <label htmlFor="reply" className="sr-only">Reply</label>
        <textarea id="reply" name="body" rows={3} required maxLength={4000} value={body} disabled={disabled || pending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); formRef.current?.requestSubmit(); } }}
          placeholder={disabled ? 'This conversation is resolved.' : `Reply to ${customerName}…`}
          className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3.5 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed" />
        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
            <button type="button" role="switch" aria-checked={muted} onClick={() => setMutedFor(ticketId, !muted)}
              className={clsx('relative h-5 w-9 rounded-full transition-colors', muted ? 'bg-neutral-900' : 'bg-neutral-300')}>
              <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', muted ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
            </button>
            Mute this thread
          </label>
          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] text-neutral-400 sm:inline">Ctrl + Enter</span>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={disabled || pending || !body.trim()}>
              {pending ? 'Sending…' : 'Send'} <Send className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
