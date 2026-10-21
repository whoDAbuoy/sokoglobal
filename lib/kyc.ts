/**
 * Platform KYC rules (pure; Edge-safe so middleware can use the gate).
 * Contract: supabase/migrations/017_kyc_system.sql.
 */
export type KycStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected';
export type KycDocumentType = 'national_id' | 'passport' | 'business_license' | 'tax_certificate';
export type KycAction = 'listings' | 'orders';
export interface KycRequirements { listings: boolean; orders: boolean }

export const KYC_DOCUMENTS: { type: KycDocumentType; label: string; group: 'identity' | 'business'; hint: string }[] = [
  { type: 'national_id', label: 'National ID', group: 'identity', hint: 'Front of the card; all four corners visible' },
  { type: 'passport', label: 'Passport', group: 'identity', hint: 'The photo page' },
  { type: 'business_license', label: 'Business licence / registration', group: 'business', hint: 'Certificate of incorporation or trading licence' },
  { type: 'tax_certificate', label: 'Tax certificate', group: 'business', hint: 'e.g. KRA PIN certificate, TIN registration' },
];
export const KYC_LABEL = Object.fromEntries(KYC_DOCUMENTS.map((d) => [d.type, d.label])) as Record<KycDocumentType, string>;
export const isKycDocumentType = (v: string): v is KycDocumentType => KYC_DOCUMENTS.some((d) => d.type === v);
export const groupOf = (t: KycDocumentType) => KYC_DOCUMENTS.find((d) => d.type === t)!.group;

export const KYC_MAX_BYTES = 10 * 1024 * 1024;
export const KYC_MIME: Record<string, 'pdf' | 'jpg' | 'png'> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Mirrors submit_kyc_verification(): upper-cased, 3–40 letters / digits / space / . / - */
export function normalizeDocumentNumber(v: string): string | null {
  const n = v.trim().toUpperCase().replace(/\s+/g, ' ');
  return /^[A-Z0-9][A-Z0-9 /.-]{2,39}$/.test(n) ? n : null;
}

/** "<uid>/verification/<uuid>.<ext>": the only path the storage policy and the table accept. */
export function verificationPath(userId: string, uuid: string, ext: 'pdf' | 'jpg' | 'png'): string {
  return `${userId}/verification/${uuid}.${ext}`;
}

export function maskDocumentNumber(n: string): string {
  return n.length <= 4 ? n : `${'•'.repeat(Math.min(6, n.length - 4))}${n.slice(-4)}`;
}

export interface KycDoc { document_type: KycDocumentType; status: KycStatus }

/** Same rule as kyc_requirements_met(): an approved identity document AND an approved business document. */
export function requirementsMet(docs: readonly KycDoc[]): boolean {
  const ok = (g: 'identity' | 'business') => docs.some((d) => d.status === 'approved' && groupOf(d.document_type) === g);
  return ok('identity') && ok('business');
}

/** Checklist state per group: the best status among that group's documents. */
export function checklist(docs: readonly KycDoc[]): Record<'identity' | 'business', KycStatus> {
  const rank: KycStatus[] = ['unsubmitted', 'rejected', 'pending', 'approved'];
  const best = (g: 'identity' | 'business') => docs.filter((d) => groupOf(d.document_type) === g)
    .reduce<KycStatus>((acc, d) => (rank.indexOf(d.status) > rank.indexOf(acc) ? d.status : acc), 'unsubmitted');
  return { identity: best('identity'), business: best('business') };
}

export const KYC_STATUS_META: Record<KycStatus, { label: string; tone: string }> = {
  unsubmitted: { label: 'Not verified', tone: 'tone-muted' },
  pending: { label: 'In review', tone: 'tone-pending' },
  approved: { label: 'Verified', tone: 'tone-escrow' },
  rejected: { label: 'Action needed', tone: 'tone-danger' },
};

/** Where an account completes KYC: suppliers keep the business KYC + payout flow. */
export const kycHome = (role: string | null | undefined) => (role === 'supplier' ? '/supplier/verification' : '/dashboard/kyc');

export type KycGate = { kind: 'allow' } | { kind: 'redirect'; to: string } | { kind: 'forbid'; error: string };

const LISTING_PAGES = ['/supplier/products/new', '/supplier/products/import'];
const ORDER_APIS = [/^\/api\/orders\/?$/, /^\/api\/checkout\/?$/, /^\/api\/pools\/[^/]+\/join\/?$/];

/**
 * Middleware gate for high-value actions (Postgres enforces the same on insert):
 * new listings (pages + their server actions) and new escrow orders (API).
 * Supplier payouts are held until KYC approval by begin_payout() itself.
 */
export function kycGate(input: { path: string; method: string; isServerAction?: boolean; role: string | null | undefined; status: KycStatus | null; required: KycRequirements }): KycGate {
  if (input.status === 'approved' || input.status === null) return { kind: 'allow' };   // null: migration 017 not applied
  const p = input.path;
  if (input.required.listings && LISTING_PAGES.some((x) => p === x || p.startsWith(`${x}/`))) {
    if (input.isServerAction || input.method !== 'GET') return { kind: 'forbid', error: 'Complete business verification (KYC) before creating listings.' };
    return { kind: 'redirect', to: `${kycHome(input.role)}?next=${encodeURIComponent(p)}` };
  }
  if (input.required.orders && input.method === 'POST' && ORDER_APIS.some((re) => re.test(p))) {
    return { kind: 'forbid', error: 'Verify your business before placing escrow orders: open your dashboard and choose Start verification.' };
  }
  return { kind: 'allow' };
}

export function parseKycStatus(v: unknown): KycStatus | null {
  return v === 'unsubmitted' || v === 'pending' || v === 'approved' || v === 'rejected' ? v : null;
}
