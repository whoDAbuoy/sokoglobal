'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Loader2, Trash2, X } from 'lucide-react';
import { removeAvatar, uploadAvatar } from '@/app/dashboard/settings/actions';

const SIZE = 512;

/**
 * Pick → validate (PNG / JPEG) → centre-crop to a 512 px square in the browser
 * (re-encoding as JPEG also strips EXIF data such as GPS) → preview → save.
 * The server checks the bytes again before storing them.
 */
export default function AvatarUpload({ url, initials, disabled }: { url: string | null; initials: string; disabled?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ blob: Blob; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.src); }, [preview]);

  async function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Use a PNG or JPEG image.');
    try {
      const blob = await squareJpeg(file);
      setPreview({ blob, src: URL.createObjectURL(blob) });
    } catch {
      setError('That image could not be read. Try another file.');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const save = () => start(async () => {
    if (!preview) return;
    const fd = new FormData();
    fd.set('avatar', new File([preview.blob], 'avatar.jpg', { type: 'image/jpeg' }));
    const res = await uploadAvatar(fd);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message);
    setPreview(null);
    router.refresh();
  });

  const remove = () => start(async () => {
    const res = await removeAvatar();
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) router.refresh();
  });

  const shown = preview?.src ?? url;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <span className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-2xl font-semibold text-snow shadow-[0_8px_24px_-8px_rgb(59_130_246/0.7)] ring-4 ring-white/70 dark:ring-snow/10">
        {shown
          // eslint-disable-next-line @next/next/no-img-element -- blob: previews and the user's own public avatar; tiny, already 512 px
          ? <img src={shown} alt="Profile photo" width={80} height={80} className="h-full w-full object-cover" />
          : <span aria-hidden>{initials}</span>}
        {pending && <span className="absolute inset-0 grid place-items-center bg-black/40"><Loader2 className="h-6 w-6 animate-spin text-snow" aria-hidden /></span>}
      </span>
      <div className="min-w-0 space-y-2">
        <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" id="avatar-file" onChange={(e) => void choose(e.target.files?.[0])} disabled={disabled || pending} />
        {preview ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending} className="btn-primary px-3 py-2 text-sm">Save photo</button>
            <button type="button" onClick={() => setPreview(null)} disabled={pending} className="btn-secondary px-3 py-2 text-sm"><X className="h-4 w-4" aria-hidden /> Cancel</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <label htmlFor="avatar-file" aria-disabled={disabled || pending}
              className="btn-secondary cursor-pointer px-3 py-2 text-sm aria-disabled:pointer-events-none aria-disabled:opacity-50">
              <Camera className="h-4 w-4" aria-hidden /> {url ? 'Change photo' : 'Upload photo'}
            </label>
            {url && (
              <button type="button" onClick={remove} disabled={disabled || pending} className="press inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-400">
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-600">PNG or JPEG. Cropped to a square; shown to suppliers, buyers and support.</p>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

/** Centre-crop to a square and re-encode as a 512 px JPEG on a white background. */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no canvas');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, SIZE, SIZE);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.88));
}
