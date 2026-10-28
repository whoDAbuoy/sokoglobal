/**
 * Where to send someone after sign-in, the 2FA check or a checkout login: only a path on this site, or null.
 * Browsers read "\" as "/" and drop tabs and newlines inside URLs, so "/\evil.example" or "/<tab>/evil.example"
 * leave the site even though they start with one "/". Anything with a backslash or a control character (also
 * percent-encoded) is refused, and the rest must resolve to this origin.
 */
const BASE = 'https://same-site.invalid';
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

export function sameSitePath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || UNSAFE.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (UNSAFE.test(decoded) || decoded.startsWith('//')) return null;
  try {
    const u = new URL(value, BASE);
    return u.origin === BASE ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}
