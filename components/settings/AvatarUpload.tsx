'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Expand, Loader2, Minimize, RotateCw, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { removeAvatar, uploadAvatar } from '@/app/dashboard/settings/actions';
import { AVATAR_MAX_BYTES } from '@/lib/settings';
import {
  clampOffset, fillScale, fitScale, initialCrop, rotateCw, rotated, scaleToSlider, sliderToScale, zoomTo,
  type CropImage, type CropState,
} from '@/lib/avatar-crop';

const SIZE = 512;   // saved avatar, px
const VIEW = 288;   // crop frame, in the viewport units lib/avatar-crop works in

type Source = { bitmap: ImageBitmap; img: CropImage };

/**
 * Pick → validate (PNG / JPEG) → position, zoom, fit / fill and rotate in the crop
 * editor → save as a 512 px JPEG drawn in the browser (re-encoding also strips EXIF
 * data such as GPS). The preview uses the same draw call as the saved file.
 * The server checks the bytes again before storing them.
 */
export default function AvatarUpload({ url, initials, disabled }: { url: string | null; initials: string; disabled?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => () => source?.bitmap.close(), [source]);

  async function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Use a PNG or JPEG image.');
    if (file.size > AVATAR_MAX_BYTES) return setError('Choose an image under 5 MB.');
    try {
      const bitmap = await createImageBitmap(file);
      const img = { width: bitmap.width, height: bitmap.height };
      setSource({ bitmap, img });
      setCrop(initialCrop(img, VIEW));
    } catch {
      setError('That image could not be read. Try another file.');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const cancel = () => { setSource(null); setCrop(null); };

  const save = () => start(async () => {
    if (!source || !crop) return;
    let blob: Blob;
    try {
      blob = await renderJpeg(source, crop);
    } catch {
      setError('That image could not be processed. Try another file.');
      return;
    }
    const fd = new FormData();
    fd.set('avatar', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
    const res = await uploadAvatar(fd);
    if (!res.ok) { setError(res.message); return; }
    toast.success(res.message);
    cancel();
    router.refresh();
  });

  const remove = () => start(async () => {
    const res = await removeAvatar();
    (res.ok ? toast.success : toast.error)(res.message);
    if (res.ok) router.refresh();
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5">
        <span className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#5a9895] to-teal-500 text-2xl font-semibold text-snow shadow-[0_8px_24px_-8px_rgb(90_152_149/0.7)] ring-4 ring-white/70 dark:ring-snow/10">
          {source && crop
            ? <CropCanvas source={source} crop={crop} className="h-full w-full" />
            : url
              // eslint-disable-next-line @next/next/no-img-element -- the user's own public avatar; tiny, already 512 px
              ? <img src={url} alt="Profile photo" width={80} height={80} className="h-full w-full object-cover" />
              : <span aria-hidden>{initials}</span>}
          {pending && <span className="absolute inset-0 grid place-items-center bg-black/40"><Loader2 className="h-6 w-6 animate-spin text-snow" aria-hidden /></span>}
        </span>
        <div className="min-w-0 space-y-2">
          <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" id="avatar-file" onChange={(e) => void choose(e.target.files?.[0])} disabled={disabled || pending} />
          {!source && (
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
          <p className="text-xs text-neutral-600">
            {source ? 'Drag to position, zoom to resize. The circle shows what others will see.' : 'PNG or JPEG up to 5 MB. You can crop, zoom and rotate before saving; shown to suppliers, buyers and support.'}
          </p>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        </div>
      </div>

      {source && crop && (
        <CropEditor source={source} crop={crop} onChange={setCrop} disabled={pending}
          onSave={save} onCancel={cancel} />
      )}
    </div>
  );
}

/* ── Editor ──────────────────────────────────────────────────────────────── */

function CropEditor({ source, crop, onChange, onSave, onCancel, disabled }: {
  source: Source; crop: CropState; onChange: (c: CropState) => void; onSave: () => void; onCancel: () => void; disabled: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const { img } = source;

  /** CSS px on screen → crop units (the frame is responsive, the math is fixed at VIEW). */
  const unit = () => VIEW / (frame.current?.getBoundingClientRect().width || VIEW);
  const pan = useCallback((dx: number, dy: number) => {
    const c = cropRef.current;
    onChange(clampOffset({ ...c, x: c.x + dx, y: c.y + dy }, img, VIEW));
  }, [img, onChange]);
  const zoomBy = useCallback((factor: number) => onChange(zoomTo(cropRef.current, cropRef.current.scale * factor, img, VIEW)), [img, onChange]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: distance(), scale: cropRef.current.scale };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      onChange(zoomTo(cropRef.current, pinch.current.scale * (distance() / pinch.current.dist), img, VIEW));
    } else if (pointers.current.size === 1) {
      const u = unit();
      pan((e.clientX - prev.x) * u, (e.clientY - prev.y) * u);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => pan(-step, 0), ArrowRight: () => pan(step, 0), ArrowUp: () => pan(0, -step), ArrowDown: () => pan(0, step),
      '+': () => zoomBy(1.1), '=': () => zoomBy(1.1), '-': () => zoomBy(1 / 1.1),
    };
    if (moves[e.key]) { e.preventDefault(); moves[e.key](); }
  };

  const r = rotated(img, crop.rotation);
  const slider = Math.round(scaleToSlider(crop.scale, img, VIEW, crop.rotation) * 1000);
  const fit = () => onChange({ ...crop, scale: fitScale(r, VIEW), x: 0, y: 0 });
  const fill = () => onChange({ ...crop, scale: fillScale(r, VIEW), x: 0, y: 0 });

  return (
    <div className="card space-y-4 p-4 sm:p-5">
      <div
        ref={frame}
        role="application"
        tabIndex={0}
        aria-label="Photo crop area. Drag or use the arrow keys to move the photo, plus and minus to zoom."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative mx-auto aspect-square w-full max-w-72 cursor-grab touch-none select-none overflow-hidden rounded-xl bg-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:cursor-grabbing"
      >
        <CropCanvas source={source} crop={crop} className="h-full w-full" />
        {/* Circular mask: what the avatar shows; the corners stay visible but dimmed. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] ring-2 ring-white/80" />
      </div>

      <div className="mx-auto flex max-w-72 items-center gap-3">
        <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={disabled} className="press rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100" aria-label="Zoom out"><ZoomOut className="h-4 w-4" aria-hidden /></button>
        <input type="range" min={0} max={1000} value={slider} disabled={disabled} aria-label="Zoom"
          onChange={(e) => onChange(zoomTo(crop, sliderToScale(Number(e.target.value) / 1000, img, VIEW, crop.rotation), img, VIEW))}
          className="h-1.5 flex-1 cursor-pointer accent-blue-600" />
        <button type="button" onClick={() => zoomBy(1.2)} disabled={disabled} className="press rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100" aria-label="Zoom in"><ZoomIn className="h-4 w-4" aria-hidden /></button>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={fit} disabled={disabled} className="btn-secondary px-3 py-1.5 text-sm" title="Show the whole photo"><Minimize className="h-4 w-4" aria-hidden /> Fit</button>
        <button type="button" onClick={fill} disabled={disabled} className="btn-secondary px-3 py-1.5 text-sm" title="Fill the circle"><Expand className="h-4 w-4" aria-hidden /> Fill</button>
        <button type="button" onClick={() => onChange(rotateCw(crop, img, VIEW))} disabled={disabled} className="btn-secondary px-3 py-1.5 text-sm"><RotateCw className="h-4 w-4" aria-hidden /> Rotate</button>
        <button type="button" onClick={() => onChange(initialCrop(img, VIEW))} disabled={disabled} className="btn-secondary px-3 py-1.5 text-sm"><Undo2 className="h-4 w-4" aria-hidden /> Reset</button>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-4">
        <button type="button" onClick={onCancel} disabled={disabled} className="btn-secondary px-3 py-2 text-sm"><X className="h-4 w-4" aria-hidden /> Cancel</button>
        <button type="button" onClick={onSave} disabled={disabled} className="btn-primary px-3 py-2 text-sm">
          {disabled && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save photo
        </button>
      </div>
    </div>
  );
}

/** Live preview: draws the current crop at the element's on-screen resolution. */
function CropCanvas({ source, crop, className }: { source: Source; crop: CropState; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const px = Math.max(1, Math.round(canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1)));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    drawCrop(g, px, source, crop);
  }, [source, crop]);
  return <canvas ref={ref} aria-hidden className={className} />;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

/** Draws the crop into a size×size square on white (fitted photos get white padding). */
function drawCrop(g: CanvasRenderingContext2D, size: number, { bitmap, img }: Source, crop: CropState) {
  const k = size / VIEW;
  g.save();
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.imageSmoothingQuality = 'high';
  g.translate(size / 2 + crop.x * k, size / 2 + crop.y * k);
  g.rotate((crop.rotation * Math.PI) / 180);
  g.scale(crop.scale * k, crop.scale * k);
  g.drawImage(bitmap, -img.width / 2, -img.height / 2);
  g.restore();
}

async function renderJpeg(source: Source, crop: CropState): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no canvas');
  drawCrop(g, SIZE, source, crop);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.9));
}
