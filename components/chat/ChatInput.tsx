'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, Loader2, Paperclip, Send } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CHAT_MESSAGE_COLUMNS, MAX_MESSAGE_LENGTH, validateMessage, type ChatMessage, type ChatMessageType } from '@/lib/chat';
import {
  ATTACH_ACCEPT, CHAT_BUCKET, attachmentPath, baseMime, classifyFile, extForAudio, signatureMatches, sniffMime,
} from '@/lib/chat-media';
import { insertAtCursor } from '@/lib/emoji';
import EmojiPicker from './EmojiPicker';
import VoiceRecorder, { type VoiceClip } from './VoiceRecorder';

const COUNTER_FROM = MAX_MESSAGE_LENGTH - 500;
const MAX_FILES_AT_ONCE = 5;

const errorMessage = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message ? err.message : fallback;

/**
 * Chat composer: text with an emoji picker, file attachments (images, videos,
 * PDF / XLSX / DOCX up to 50 MB) and voice notes. Files go straight from the
 * browser to the private chat-attachments bucket under "<scope>/<me>/…", then a
 * message row points at them; Postgres checks the path, that the file exists,
 * and its real type and size (migrations 024, 025).
 */
export default function ChatInput({ threadId, attachmentScope, myId, onSent, composerExtra }: {
  threadId: string;
  /** First folder for uploads (lib/chat-admin.ts attachmentScope); null until the thread has loaded. */
  attachmentScope: string | null;
  myId: string | null;
  onSent: (message: ChatMessage) => void;
  composerExtra?: ReactNode;
}) {
  const supabase = createClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const media = !!attachmentScope && !!myId;
  const busy = sending || !!uploading;

  async function insert(row: { content: string; message_type: ChatMessageType; metadata?: Record<string, unknown> }) {
    const { data, error: e } = await supabase.from('chat_messages')
      .insert({ thread_id: threadId, sender_id: myId, ...row }).select(CHAT_MESSAGE_COLUMNS).single();
    if (e) throw e;
    onSent(data as ChatMessage);
  }

  async function sendText(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !myId) return;
    const v = validateMessage(text);
    if (!v.ok) { setError(v.error); return; }
    setSending(true);
    setError(null);
    try {
      await insert({ content: v.content, message_type: 'text' });
      setText('');
      inputRef.current?.focus();
    } catch (err) {
      setError(errorMessage(err, 'Could not send your message'));
    } finally {
      setSending(false);
    }
  }

  /** Upload to Storage, then post the message. Throws with a readable message. */
  async function sendAttachment(blob: Blob, fileName: string, mime: string, type: Exclude<ChatMessageType, 'text'>, extra: Record<string, unknown> = {}) {
    if (!attachmentScope || !myId) throw new Error('Attachments are not available yet. Try again in a moment.');
    const path = attachmentPath(attachmentScope, myId, fileName, crypto.randomUUID());
    const { error: upErr } = await supabase.storage.from(CHAT_BUCKET).upload(path, blob, { contentType: baseMime(mime), upsert: false, cacheControl: '3600' });
    if (upErr) throw new Error(/exceed|too large|413/i.test(upErr.message) ? 'That file is over the 50 MB limit.' : `Upload failed: ${upErr.message}`);
    await insert({ content: path, message_type: type, metadata: { file_name: fileName.slice(0, 200), size: blob.size, mime_type: baseMime(mime), ...extra } });
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = [...list].slice(0, MAX_FILES_AT_ONCE);
    for (const file of files) {
      const c = classifyFile(file);
      if (!c.ok) { setError(c.error); continue; }
      // Check the real file header, so a renamed .exe can't pose as a PDF.
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      if (!signatureMatches(c.mime, sniffMime(head))) { setError(`“${file.name}” isn’t a valid ${c.ext.toUpperCase()} file.`); continue; }
      setUploading(file.name);
      try {
        await sendAttachment(file, file.name, c.mime, c.type);
      } catch (err) {
        setError(errorMessage(err, `Could not send “${file.name}”`));
      } finally {
        setUploading(null);
      }
    }
    if (list.length > MAX_FILES_AT_ONCE) setError(`Only the first ${MAX_FILES_AT_ONCE} files were sent.`);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function sendVoice(clip: VoiceClip) {
    const name = `voice-note-${new Date().toISOString().replace(/[:.]/g, '-')}.${extForAudio(clip.mimeType)}`;
    setUploading('voice note');
    try {
      await sendAttachment(clip.blob, name, clip.mimeType, 'voice_note', { duration_seconds: clip.durationSeconds, waveform: clip.waveform });
    } finally {
      setUploading(null);
    }
  }

  function addEmoji(emoji: string) {
    const el = inputRef.current;
    const r = insertAtCursor(text, el?.selectionStart, el?.selectionEnd, emoji);
    setText(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.caret, r.caret); });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void sendText();
    }
  }

  const length = text.trim().length;

  return (
    <form onSubmit={(e) => void sendText(e)} className="border-t border-neutral-200 bg-white px-3 py-3 sm:px-5"
      onDragOver={(e) => { if (media) e.preventDefault(); }}
      onDrop={(e) => { if (!media) return; e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
      <div className="flex items-end gap-1.5">
        {!recording && <EmojiPicker onPick={addEmoji} disabled={!myId} />}
        {media && !recording && (
          <>
            <input ref={fileRef} type="file" accept={ATTACH_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => void onFiles(e.target.files)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach images, videos or documents"
              className="grid h-9 w-9 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50">
              <Paperclip className="h-5 w-5" aria-hidden />
            </button>
          </>
        )}
        {!recording && (
          <>
            <label htmlFor={`chat-input-${threadId}`} className="sr-only">Message</label>
            <textarea id={`chat-input-${threadId}`} ref={inputRef} value={text}
              onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
              onKeyDown={onKeyDown} rows={1} placeholder={media ? 'Message, or attach a file…' : 'Write a message…'} disabled={!myId}
              className="input max-h-40 min-h-[2.5rem] flex-1 resize-none py-2" />
          </>
        )}
        {media && (length === 0 || recording) && <VoiceRecorder onSend={sendVoice} onRecordingChange={setRecording} disabled={busy} />}
        {!recording && (length > 0 || !media) && (
          <button type="submit" disabled={busy || !myId || length === 0} aria-label="Send message" className="btn-primary h-10 shrink-0 px-4">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">Send</span>
          </button>
        )}
      </div>
      <div className="mt-1.5 flex min-h-[1rem] items-start justify-between gap-3 text-xs">
        {error
          ? <p role="alert" className="flex items-start gap-1.5 text-red-600"><AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}</p>
          : uploading
            ? <p role="status" className="flex items-center gap-1.5 text-neutral-600"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Sending {uploading}…</p>
            : <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{composerExtra}
                <p className="text-neutral-500">Enter to send · Shift+Enter for a new line{media ? ' · drop files here' : ''}</p></div>}
        {length >= COUNTER_FROM && (
          <span className={clsx('shrink-0 tabular-nums', length > MAX_MESSAGE_LENGTH ? 'text-red-600' : 'text-neutral-500')}>
            {length.toLocaleString('en-GB')}/{MAX_MESSAGE_LENGTH.toLocaleString('en-GB')}
          </span>
        )}
      </div>
    </form>
  );
}
