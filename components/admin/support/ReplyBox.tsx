'use client';

import { useRef, useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { replyToTicket } from '@/app/admin/support/actions';
import { useMutedTickets } from './useMutedTickets';
import MuteSwitch from '@/components/chat/MuteSwitch';

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
    <form ref={formRef} action={submit} className="sticky bottom-0 border-t border-neutral-200 bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:p-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 focus-within:border-neutral-400">
        <label htmlFor="reply" className="sr-only">Reply</label>
        <textarea id="reply" name="body" rows={2} required maxLength={4000} value={body} disabled={disabled || pending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); formRef.current?.requestSubmit(); } }}
          placeholder={disabled ? 'This conversation is resolved.' : `Reply to ${customerName}…`}
          className="block max-h-40 min-h-[2.75rem] w-full resize-none rounded-t-lg border-0 bg-transparent px-3.5 py-2.5 text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed md:min-h-[4.5rem] md:py-3 md:text-sm" />
        <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2">
          <MuteSwitch muted={muted} onChange={(v) => setMutedFor(ticketId, v)} />
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
