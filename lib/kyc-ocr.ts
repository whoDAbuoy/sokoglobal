/**
 * KYC OCR rules (pure). The model reads the document; this module validates what
 * it returned, compares it with what the user told us, and scores the result.
 * The score is advisory for reviewers — it never approves or rejects anything.
 */
import { groupOf, type KycDocumentType } from './kyc';

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

/** Structured-output schema for the extraction call (all keys required, no extras). */
export const OCR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'document_type_detected', 'full_name', 'business_name', 'document_number', 'date_of_birth',
    'expiry_date', 'issuing_country', 'text_confidence', 'issues'],
  properties: {
    legible: { type: 'boolean', description: 'Whether the document text can be read reliably.' },
    document_type_detected: { type: 'string', enum: ['national_id', 'passport', 'business_license', 'tax_certificate', 'other', 'unknown'] },
    full_name: { ...nullableString, description: "The person's full name as printed (identity documents), else null." },
    business_name: { ...nullableString, description: 'The registered business name as printed (business documents), else null.' },
    document_number: { ...nullableString, description: 'ID / passport / registration / tax number exactly as printed.' },
    date_of_birth: { ...nullableString, description: 'YYYY-MM-DD, or null.' },
    expiry_date: { ...nullableString, description: 'YYYY-MM-DD, or null if none is printed.' },
    issuing_country: { ...nullableString, description: 'ISO 3166-1 alpha-2 code of the issuing country, or null.' },
    text_confidence: { type: 'number', description: 'Your confidence from 0 to 1 that the extracted fields are read correctly.' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Short notes: blur, glare, cropped edges, signs of editing, mismatched fonts.' },
  },
} as const;

export type DetectedType = KycDocumentType | 'other' | 'unknown';
export interface OcrFields {
  legible: boolean; document_type_detected: DetectedType; full_name: string | null; business_name: string | null;
  document_number: string | null; date_of_birth: string | null; expiry_date: string | null; issuing_country: string | null;
  text_confidence: number; issues: string[];
}

const DETECTED: DetectedType[] = ['national_id', 'passport', 'business_license', 'tax_certificate', 'other', 'unknown'];
const optStr = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isoDate = (v: unknown): string | null => {
  const s = optStr(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};

/** Validates and normalises the model's JSON; null when it is not the expected shape. */
export function parseOcrOutput(raw: unknown): OcrFields | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.legible !== 'boolean' || typeof o.text_confidence !== 'number' || !Number.isFinite(o.text_confidence)) return null;
  const type = DETECTED.includes(o.document_type_detected as DetectedType) ? (o.document_type_detected as DetectedType) : 'unknown';
  const country = optStr(o.issuing_country, 2)?.toUpperCase() ?? null;
  return {
    legible: o.legible,
    document_type_detected: type,
    full_name: optStr(o.full_name),
    business_name: optStr(o.business_name),
    document_number: optStr(o.document_number, 60),
    date_of_birth: isoDate(o.date_of_birth),
    expiry_date: isoDate(o.expiry_date),
    issuing_country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    text_confidence: Math.min(1, Math.max(0, o.text_confidence)),
    issues: Array.isArray(o.issues) ? o.issues.filter((i): i is string => typeof i === 'string').map((i) => i.slice(0, 200)).slice(0, 10) : [],
  };
}

export type Check = 'match' | 'mismatch' | 'unknown';
export interface OcrChecks { type: Check; number: Check; name: Check; country: Check; expired: boolean; name_similarity: number | null }

const tokens = (s: string, drop: ReadonlySet<string> = new Set()) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !drop.has(t));

const COMPANY_SUFFIXES = new Set(['ltd', 'limited', 'llc', 'inc', 'incorporated', 'co', 'company', 'plc', 'corp', 'corporation', 'the', 'and', 'of']);

/** Share of the shorter name's words found in the other (order-free, so "DOE JOHN" matches "John Doe"). */
export function nameSimilarity(a: string, b: string, kind: 'person' | 'business'): number {
  const drop = kind === 'business' ? COMPANY_SUFFIXES : new Set<string>();
  const ta = new Set(tokens(a, drop));
  const tb = new Set(tokens(b, drop));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / Math.min(ta.size, tb.size);
}

export const normalizeNumber = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface SubmittedDetails {
  documentType: KycDocumentType; documentNumber: string; fullName: string | null; companyName: string | null; countryCode: string | null;
}

export function compareWithSubmission(f: OcrFields, s: SubmittedDetails, today = new Date()): OcrChecks {
  const business = groupOf(s.documentType) === 'business';
  const type: Check = f.document_type_detected === 'unknown' ? 'unknown' : f.document_type_detected === s.documentType ? 'match' : 'mismatch';
  const number: Check = !f.document_number ? 'unknown'
    : normalizeNumber(f.document_number) === normalizeNumber(s.documentNumber) ? 'match' : 'mismatch';
  const expected = business ? s.companyName : s.fullName;
  const printed = business ? f.business_name : f.full_name;
  const similarity = expected && printed ? nameSimilarity(expected, printed, business ? 'business' : 'person') : null;
  const name: Check = similarity === null ? 'unknown' : similarity >= 0.66 ? 'match' : 'mismatch';
  // Business documents are often issued where the company is registered, so country only counts for identity documents.
  const country: Check = business || !f.issuing_country || !s.countryCode ? 'unknown'
    : f.issuing_country === s.countryCode.toUpperCase() ? 'match' : 'mismatch';
  const expired = !!f.expiry_date && Date.parse(f.expiry_date) < today.getTime() - 86_400_000;
  return { type, number, name, country, expired, name_similarity: similarity === null ? null : Math.round(similarity * 100) / 100 };
}

const WEIGHTS = { number: 0.35, name: 0.35, type: 0.2, country: 0.1 } as const;
const VALUE: Record<Check, number> = { match: 1, unknown: 0.5, mismatch: 0 };

/**
 * 0–1: how well the document supports the submission. Reading confidence × weighted
 * field agreement; illegible documents score 0 and expired ones at most 0.2.
 */
export function confidenceScore(f: OcrFields, c: OcrChecks): number {
  if (!f.legible) return 0;
  const agreement = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((sum, k) => sum + WEIGHTS[k] * VALUE[c[k]], 0);
  const score = f.text_confidence * agreement;
  return Math.round((c.expired ? Math.min(score, 0.2) : score) * 1000) / 1000;
}

export type OcrVerdict = 'strong' | 'review' | 'weak';
export const ocrVerdict = (score: number): OcrVerdict => (score >= 0.8 ? 'strong' : score >= 0.5 ? 'review' : 'weak');
