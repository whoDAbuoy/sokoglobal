'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Inbox, X } from 'lucide-react';
import ChatThread from '@/components/chat/ChatThread';

/** Right-side chat sheet, rendered by <ChatProvider>. */
export default function ChatDrawer({ open, threadId, title, counterpartName, inboxPath, onClose, onRead }: {
  open: boolean;
  threadId: string | null;
  title: string | null;
  counterpartName: string | null;
  inboxPath: '/dashboard/messages' | '/supplier/messages';
  onClose: () => void;
  onRead?: () => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
    const gap = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingRight = `${gap}px`;
    return () => { html.style.overflow = prev.overflow; html.style.paddingRight = prev.paddingRight; };
  }, [open]);

  return (
    <dialog ref={dialogRef} aria-labelledby="chat-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md border-l border-neutral-200 p-0 text-neutral-900 shadow-overlay frost-panel frost-backdrop dark:border-snow/10 motion-safe:animate-slide-in-right backdrop:motion-safe:animate-fade-in">
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-6 py-5">
          <div className="min-w-0">
            <h2 id="chat-title" className="truncate text-lg font-semibold text-neutral-900">{title ?? 'Conversation'}</h2>
            <p className="truncate text-xs text-neutral-500">{counterpartName ? `with ${counterpartName}` : 'Messages are private to you and the other party'}</p>
            {threadId && (
              <Link href={`${inboxPath}?thread=${threadId}`} onClick={onClose}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-neutral-700 underline-offset-4 hover:text-neutral-900 hover:underline">
                <Inbox className="h-3.5 w-3.5" /> Open inbox
              </Link>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close chat"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900">
            <X className="h-4 w-4" />
          </button>
        </header>
        {open && threadId && <ChatThread key={threadId} threadId={threadId} onRead={onRead} className="flex-1" />}
      </div>
    </dialog>
  );
}
