export const TRIAL_BATCH_MIN_CENTS = 50_000; // $500 — mirrors trial_batch_min_cents() in SQL

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatUSD = (cents: number, exact = false) => (exact ? usdExact : usd).format(cents / 100);

export function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

const regionNames = typeof Intl.DisplayNames !== 'undefined'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const countryName = (code: string) => {
  try { return regionNames?.of(code.toUpperCase()) ?? code; } catch { return code; }
};

/** Regional-indicator flag emoji from an ISO-3166 alpha-2 code. */
export const flag = (code: string) =>
  code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

/** Turn Postgres/PostgREST error messages into something safe to show users. */
export function friendlyError(message: string | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (message.includes('violates row-level security') || message.includes('permission denied')) {
    return 'You do not have permission to perform this action.';
  }
  return message.replace(/^ERROR:\s*/, '');
}
