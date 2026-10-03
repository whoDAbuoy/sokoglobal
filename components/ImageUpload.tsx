'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import clsx from 'clsx';
import {
  AlertCircle, Camera, CheckCircle2, Film, ImagePlus, Loader2, RotateCw, ShieldCheck, UploadCloud, X,
} from 'lucide-react';
import type { MediaType, ProductMedia } from '@/lib/types';
import { MIN_IMAGE_EDGE_PX, UPLOAD_RULES, mediaTypeForMime } from '@/lib/uploads';

type Status = 'ready' | 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;
  mediaType: MediaType;
  width?: number;
  height?: number;
  status: Status;
  progress: number;
  error?: string;
}

interface ImageUploadProps {
  productId: string;
  /** Allow standardized swatch videos alongside photos. */
  allowVideo?: boolean;
  maxFiles?: number;
  onUploaded?: (media: ProductMedia) => void;
}

const CONCURRENCY = 3;

/** Read pixel dimensions locally so low-quality photos are rejected before upload. */
async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * PUT the file to the Supabase signed upload URL with progress events.
 * (fetch() has no upload progress, so XHR is used. Body format matches
 * supabase-js `uploadToSignedUrl`.)
 */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage rejected the file (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error — check your connection and retry'));
    const body = new FormData();
    body.append('cacheControl', '31536000');
    body.append('', file);
    xhr.send(body);
  });
}

async function postJSON<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export default function ImageUpload({ productId, allowVideo = true, maxFiles = 12, onUploaded }: ImageUploadProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Free object URLs on unmount.
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  const patch = useCallback((id: string, update: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...update } : i)));
  }, []);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    setNotice(null);
    const incoming = Array.from(fileList);
    const room = maxFiles - itemsRef.current.filter((i) => i.status !== 'error').length;
    if (incoming.length > room) setNotice(`You can add ${Math.max(room, 0)} more file(s). Extra files were skipped.`);

    const accepted: UploadItem[] = [];
    const rejected: string[] = [];

    for (const file of incoming.slice(0, Math.max(room, 0))) {
      const mediaType = mediaTypeForMime(file.type);
      if (!mediaType || (mediaType === 'swatch_video' && !allowVideo)) {
        rejected.push(`${file.name}: unsupported format`);
        continue;
      }
      const rules = UPLOAD_RULES[mediaType];
      if (file.size > rules.maxBytes) {
        rejected.push(`${file.name}: exceeds ${Math.round(rules.maxBytes / 1024 / 1024)} MB`);
        continue;
      }
      let dims: { width: number; height: number } | undefined;
      if (mediaType === 'image') {
        try {
          dims = await readImageSize(file);
        } catch {
          rejected.push(`${file.name}: could not be read`);
          continue;
        }
        if (Math.max(dims.width, dims.height) < MIN_IMAGE_EDGE_PX) {
          rejected.push(`${file.name}: ${dims.width}×${dims.height}px — min ${MIN_IMAGE_EDGE_PX}px on the longest side`);
          continue;
        }
      }
      accepted.push({
        id: crypto.randomUUID(), file, mediaType, previewUrl: URL.createObjectURL(file),
        width: dims?.width, height: dims?.height, status: 'ready', progress: 0,
      });
    }

    if (rejected.length) setNotice(`Some files were not added — ${rejected.join('; ')}`);
    if (accepted.length) setItems((prev) => [...prev, ...accepted]);
  }, [allowVideo, maxFiles]);

  async function uploadOne(item: UploadItem) {
    patch(item.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      // 1. Ask our API for a signed URL (verifies auth, ownership, type & size server-side).
      const { signedUrl, path } = await postJSON<{ signedUrl: string; path: string }>('/api/uploads/sign', {
        productId, mediaType: item.mediaType, mimeType: item.file.type, size: item.file.size,
      });
      // 2. Upload bytes directly to storage — bypasses serverless body-size limits.
      //    Cloudinary alternative: swap this for a signed POST to
      //    https://api.cloudinary.com/v1_1/<cloud>/auto/upload with the signature from step 1.
      await putWithProgress(signedUrl, item.file, (progress) => patch(item.id, { progress }));
      // 3. Confirm — server verifies the stored object and records it in product_media.
      const media = await postJSON<ProductMedia>('/api/uploads/complete', {
        productId, path, mediaType: item.mediaType, width: item.width, height: item.height,
        capturedAt: new Date(item.file.lastModified).toISOString(),
      });
      patch(item.id, { status: 'done', progress: 100 });
      onUploaded?.(media);
    } catch (err) {
      patch(item.id, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }

  async function uploadAll() {
    const queue = itemsRef.current.filter((i) => i.status === 'ready' || i.status === 'error');
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await uploadOne(next);
    });
    await Promise.all(workers);
  }

  function remove(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function onDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function onDrop(e: DragEvent) {
    onDrag(e);
    setDragActive(false);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  }

  const pending = items.filter((i) => i.status === 'ready' || i.status === 'error').length;
  const uploading = items.some((i) => i.status === 'uploading');
  const accept = [
    ...Object.keys(UPLOAD_RULES.image.mimes),
    ...(allowVideo ? Object.keys(UPLOAD_RULES.swatch_video.mimes) : []),
  ].join(',');

  return (
    <section className="card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Product photos{allowVideo && ' & swatch videos'}</h3>
          <p className="mt-1 text-sm text-slate-500">
            Real, unedited photos of the exact stock. Buyers see the capture date as proof of freshness.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
          <ShieldCheck className="h-3.5 w-3.5" /> Visual Proof required
        </span>
      </header>

      {/* Drop zone */}
      <div
        onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={onDrag} onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
        role="button" tabIndex={0} aria-label="Upload product media"
        className={clsx(
          'mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition',
          dragActive ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/40',
        )}
      >
        <span className={clsx('grid h-12 w-12 place-items-center rounded-full', dragActive ? 'bg-brand-100' : 'bg-white shadow-sm ring-1 ring-slate-200')}>
          <UploadCloud className="h-6 w-6 text-brand-700" />
        </span>
        <p className="mt-4 text-sm font-medium text-slate-900">
          {dragActive ? 'Drop to add files' : <>Drag & drop files, or <span className="text-brand-700">browse</span></>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {UPLOAD_RULES.image.label}, min {MIN_IMAGE_EDGE_PX}px{allowVideo && <> · Swatch videos: {UPLOAD_RULES.swatch_video.label}</>}
        </p>
        <button type="button" onClick={(e) => { e.stopPropagation(); cameraInput.current?.click(); }}
          className="btn-secondary mt-4 py-2 text-xs sm:hidden">
          <Camera className="h-4 w-4" /> Take a live photo
        </button>
        <input ref={fileInput} type="file" multiple accept={accept} className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        {/* capture="environment" opens the rear camera on mobile for real-time photos */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {notice && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-600/20">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" /> {notice}
        </p>
      )}

      {/* Previews */}
      {items.length > 0 && (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              <div className="aspect-square">
                {item.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                ) : (
                  <video src={item.previewUrl} muted playsInline loop className="h-full w-full object-cover"
                    onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
                )}
              </div>

              {item.mediaType === 'swatch_video' && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-slate-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Film className="h-3 w-3" /> Swatch
                </span>
              )}

              {item.status !== 'uploading' && item.status !== 'done' && (
                <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.file.name}`}
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-slate-700 shadow opacity-0 transition hover:bg-white group-hover:opacity-100 focus:opacity-100">
                  <X className="h-4 w-4" />
                </button>
              )}

              {/* Status overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/80 to-transparent px-2.5 pb-2 pt-6">
                <p className="truncate text-[11px] font-medium text-white">{item.file.name}</p>
                {item.status === 'uploading' && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/25">
                    <div className="h-full rounded-full bg-white transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === 'done' && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Uploaded</p>
                )}
                {item.status === 'error' && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-red-300" title={item.error}>
                    <AlertCircle className="h-3 w-3 shrink-0" /> <span className="truncate">{item.error}</span>
                  </p>
                )}
                {item.status === 'ready' && item.width && (
                  <p className="mt-0.5 text-[11px] text-slate-300">{item.width}×{item.height}px</p>
                )}
              </div>

              {item.status === 'error' && (
                <button type="button" onClick={() => void uploadOne(item)}
                  className="absolute inset-0 m-auto grid h-10 w-10 place-items-center rounded-full bg-white/95 text-slate-800 shadow" aria-label="Retry upload">
                  <RotateCw className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {items.length < maxFiles && (
            <li>
              <button type="button" onClick={() => fileInput.current?.click()}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-brand-400 hover:text-brand-700">
                <ImagePlus className="h-5 w-5" /><span className="text-xs font-medium">Add more</span>
              </button>
            </li>
          )}
        </ul>
      )}

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-500">
          {items.filter((i) => i.status === 'done').length} uploaded · {pending} pending · max {maxFiles}
        </p>
        <button type="button" onClick={() => void uploadAll()} disabled={!pending || uploading} className="btn-primary">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? 'Uploading…' : pending ? `Upload ${pending} file${pending === 1 ? '' : 's'}` : 'Upload files'}
        </button>
      </footer>
    </section>
  );
}
