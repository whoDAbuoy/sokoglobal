/**
 * Resumable uploads to Supabase Storage over the TUS protocol
 * (POST create → PATCH chunks → HEAD to recover the offset after a failure).
 * Used for large product media; small files keep the one-shot signed upload.
 *
 * Supabase requires 6 MB chunks for resumable uploads, so CHUNK_BYTES is fixed.
 */
export const CHUNK_BYTES = 6 * 1024 * 1024;
/** Files above this use the resumable path (a single chunk gains nothing from TUS). */
export const RESUMABLE_THRESHOLD = CHUNK_BYTES;
export const MAX_RETRIES = 6;

/** TUS Upload-Metadata: comma-separated "key base64(value)" pairs, UTF-8 safe. */
export function encodeMetadata(meta: Record<string, string>): string {
  const b64 = (v: string) => btoa(Array.from(new TextEncoder().encode(v), (b) => String.fromCharCode(b)).join(''));
  return Object.entries(meta).map(([k, v]) => `${k} ${b64(v)}`).join(',');
}

/** Backoff between retries: 1 s, 2 s, 4 s … capped at 20 s. */
export const retryDelayMs = (attempt: number) => Math.min(20_000, 1000 * 2 ** Math.max(0, attempt));

export const nextChunk = (offset: number, size: number) => ({ start: offset, end: Math.min(size, offset + CHUNK_BYTES) });

export class UploadError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export interface ResumableOptions {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  bucket: string;
  objectName: string;
  contentType: string;
  cacheControl?: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

const TUS = { 'Tus-Resumable': '1.0.0' };
const retryableStatus = (s: number) => s === 0 || s === 408 || s === 409 || s === 423 || s === 429 || s >= 500;
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new UploadError('Upload cancelled', false)); }, { once: true });
});

/** One XHR (fetch has no upload progress). Resolves with status + headers; status 0 = network failure. */
function request(method: string, url: string, headers: Record<string, string>, body: Blob | null, signal?: AbortSignal,
  onUpload?: (loaded: number) => void): Promise<{ status: number; header: (n: string) => string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    if (onUpload) xhr.upload.onprogress = (e) => onUpload(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n) });
    xhr.onerror = () => resolve({ status: 0, header: () => null });
    xhr.ontimeout = () => resolve({ status: 0, header: () => null });
    xhr.timeout = 120_000;   // per chunk, not per file
    const abort = () => { xhr.abort(); reject(new UploadError('Upload cancelled', false)); };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

/**
 * Uploads `file` in 6 MB chunks. Network drops, timeouts and 5xx responses are
 * retried with backoff, resuming from the offset the server reports.
 */
export async function uploadLargeFileResumable(file: Blob, o: ResumableOptions): Promise<void> {
  const endpoint = `${o.supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`;
  const auth = { Authorization: `Bearer ${o.accessToken}`, apikey: o.anonKey };
  const report = (sent: number) => o.onProgress?.(Math.min(100, Math.round((sent / file.size) * 100)));

  // 1. Create the upload.
  let location: string | null = null;
  for (let attempt = 0; !location; attempt += 1) {
    const res = await request('POST', endpoint, {
      ...TUS, ...auth, 'x-upsert': 'false',
      'Upload-Length': String(file.size),
      'Upload-Metadata': encodeMetadata({ bucketName: o.bucket, objectName: o.objectName, contentType: o.contentType, cacheControl: o.cacheControl ?? '31536000' }),
    }, null, o.signal);
    if (res.status === 201 && res.header('Location')) { location = new URL(res.header('Location')!, endpoint).toString(); break; }
    if (!retryableStatus(res.status) || attempt >= MAX_RETRIES) {
      throw new UploadError(res.status === 413 ? 'File is larger than the storage limit' : `Storage refused the upload (${res.status || 'network error'})`, false);
    }
    await sleep(retryDelayMs(attempt), o.signal);
  }

  // 2. Send chunks; after any failure ask the server where it got to.
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    const { start, end } = nextChunk(offset, file.size);
    const res = await request('PATCH', location, {
      ...TUS, ...auth, 'Upload-Offset': String(start), 'Content-Type': 'application/offset+octet-stream',
    }, file.slice(start, end), o.signal, (loaded) => report(start + loaded));
    if (res.status === 204) {
      offset = Number(res.header('Upload-Offset') ?? end);
      failures = 0;
      report(offset);
      continue;
    }
    if (!retryableStatus(res.status) || failures >= MAX_RETRIES) {
      throw new UploadError(`Upload interrupted (${res.status || 'network error'}); please retry`, retryableStatus(res.status));
    }
    await sleep(retryDelayMs(failures), o.signal);
    failures += 1;
    const head = await request('HEAD', location, { ...TUS, ...auth }, null, o.signal);
    if (head.status === 200 && head.header('Upload-Offset')) offset = Number(head.header('Upload-Offset'));
    else if (head.status === 404 || head.status === 410) throw new UploadError('The upload session expired; please retry', true);
  }
  report(file.size);
}
