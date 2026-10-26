'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertCircle, Download, FileSpreadsheet, FileText, Loader2, Maximize2, ShieldCheck, Trash2, X } from 'lucide-react';
import { formatChatTime, type ChatMessage } from '@/lib/chat';
import { extensionOf, formatBytes } from '@/lib/chat-media';
import { useSignedUrl } from './useSignedUrl';
import VoicePlayer from './VoicePlayer';

/** Full-screen image / video viewer (native <dialog>: focus trap, Esc to close). */
function Lightbox({ dialogRef, src, kind, label }: { dialogRef: React.RefObject<HTMLDialogElement | null>; src: string | null; kind: 'image' | 'video'; label: string }) {
  return (
    <dialog ref={dialogRef} aria-label={label} onClick={(e) => { if (e.target === e.currentTarget) dialogRef.current?.close(); }}
      className="m-auto max-h-[92vh] max-w-[92vw] overflow-visible bg-transparent p-0 backdrop:bg-black/80">
      <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close"
        className="absolute -top-11 right-0 grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
        <X className="h-5 w-5" aria-hidden />
      </button>
      {src && (kind === 'image'
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
        ? <img src={src} alt={label} className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain" />
        : <video src={src} controls autoPlay className="max-h-[92vh] max-w-[92vw] rounded-lg bg-black" />)}
    </dialog>
  );
}

function MediaBody({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const meta = m.metadata ?? {};
  const name = meta.file_name ?? m.content.split('/').pop() ?? 'file';
  const type = m.message_type ?? 'text';
  const lightbox = useRef<HTMLDialogElement>(null);
  const { url, error } = useSignedUrl(type === 'text' ? null : m.content, type === 'document' ? name : undefined);

  if (error) return <p className="flex items-center gap-1.5 text-sm opacity-80"><AlertCircle className="h-4 w-4" aria-hidden /> {error}</p>;

  if (type === 'image') {
    return (
      <>
        <button type="button" onClick={() => lightbox.current?.showModal()} disabled={!url} aria-label={`Open image ${name}`}
          className="group relative block overflow-hidden rounded-xl">
          {url
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
            ? <img src={url} alt={name} loading="lazy" className="max-h-64 w-auto max-w-full object-cover transition-transform group-hover:scale-[1.02]" />
            : <span className="grid h-40 w-56 place-items-center bg-neutral-200/50"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></span>}
        </button>
        <Lightbox dialogRef={lightbox} src={url} kind="image" label={name} />
      </>
    );
  }

  if (type === 'video') {
    return (
      <div className="relative">
        {url
          ? <video src={url} controls preload="metadata" className="max-h-64 max-w-full rounded-xl bg-black" aria-label={name} />
          : <span className="grid h-40 w-56 place-items-center rounded-xl bg-neutral-200/50"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></span>}
        {url && (
          <button type="button" onClick={() => lightbox.current?.showModal()} aria-label="Expand video"
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75">
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <Lightbox dialogRef={lightbox} src={url} kind="video" label={name} />
      </div>
    );
  }

  if (type === 'document') {
    const ext = extensionOf(name).toUpperCase() || 'FILE';
    const Icon = ext === 'XLSX' ? FileSpreadsheet : FileText;
    return (
      <div className={clsx('flex w-64 max-w-full items-center gap-3 rounded-xl border p-3',
        mine ? 'border-white/20 bg-white/10' : 'border-neutral-200 bg-white dark:bg-neutral-50')}>
        <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-lg',
          ext === 'PDF' ? 'bg-red-500/15 text-red-600' : ext === 'XLSX' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-blue-500/15 text-blue-600')}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={name}>{name}</span>
          <span className={clsx('block text-xs', mine ? 'text-white/70' : 'text-neutral-500')}>{ext} · {formatBytes(meta.size)}</span>
        </span>
        <a href={url ?? undefined} download={name} aria-label={`Download ${name}`} aria-disabled={!url}
          className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-full', mine ? 'bg-white/20 hover:bg-white/30' : 'bg-neutral-100 hover:bg-neutral-200',
            !url && 'pointer-events-none opacity-50')}>
          {url ? <Download className="h-4 w-4" aria-hidden /> : <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        </a>
      </div>
    );
  }

  return <VoicePlayer src={url} durationSeconds={meta.duration_seconds} waveform={meta.waveform} mine={mine} />;
}

/**
 * One chat bubble: text, or an image / video / document / voice note from the private chat-attachments bucket.
 * Messages from SokoGlobal admins carry a badge; super admins get a delete control (`onDelete`).
 */
export default function ChatMessageItem({ message: m, mine, showRead, onDelete }: {
  message: ChatMessage; mine: boolean; showRead: boolean; onDelete?: (id: string) => Promise<void>;
}) {
  const media = (m.message_type ?? 'text') !== 'text';
  const bare = m.message_type === 'image' || m.message_type === 'video';
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!onDelete || !window.confirm('Delete this message for everyone? This cannot be undone.')) return;
    setDeleting(true);
    try { await onDelete(m.id); toast.success('Message deleted'); } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the message');
      setDeleting(false);
    }
  }
  return (
    <li className={clsx('group/msg flex flex-col', mine ? 'items-end' : 'items-start')}>
      {m.from_admin && (
        <span className="mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide tone-active">
          <ShieldCheck className="h-3 w-3" aria-hidden /> System / Admin message
        </span>
      )}
      <div className={clsx('min-w-0 max-w-[85%] break-words text-sm [overflow-wrap:anywhere]',
        bare ? '' : clsx('rounded-2xl', media ? 'p-2' : 'whitespace-pre-wrap px-3.5 py-2',
          mine ? 'rounded-br-md bg-neutral-900 text-white' : 'rounded-bl-md bg-neutral-100 text-neutral-900'))}>
        {media ? <MediaBody m={m} mine={mine} /> : m.content}
      </div>
      <span className="mt-1 px-1 text-[11px] text-neutral-400">
        <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('en-GB')}>{formatChatTime(m.created_at)}</time>
        {showRead && <> · Read</>}
        {onDelete && (
          <button type="button" onClick={() => void remove()} disabled={deleting} aria-label="Delete message"
            className="ml-2 inline-flex items-center gap-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 group-hover/msg:opacity-100">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Trash2 className="h-3 w-3" aria-hidden />} Delete
          </button>
        )}
      </span>
    </li>
  );
}
