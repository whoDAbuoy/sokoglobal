import clsx from 'clsx';
import { AlertTriangle, ScanText } from 'lucide-react';
import { ocrVerdict, type Check, type OcrChecks, type OcrFields } from '@/lib/kyc-ocr';

export interface OcrResult {
  status: 'pending' | 'completed' | 'failed' | 'skipped';
  score: number | null;
  data: { fields?: OcrFields; checks?: OcrChecks; reason?: string } | null;
}

const VERDICT = {
  strong: { label: 'Strong match', tone: 'tone-escrow' },
  review: { label: 'Check closely', tone: 'tone-pending' },
  weak: { label: 'Weak match', tone: 'tone-danger' },
} as const;
const CHECK: Record<Check, { label: string; tone: string }> = {
  match: { label: 'Matches', tone: 'text-emerald-700 dark:text-emerald-400' },
  mismatch: { label: 'Differs', tone: 'text-rose-700 dark:text-rose-400' },
  unknown: { label: 'Not read', tone: 'text-neutral-500' },
};

/** Automated read of the document vs. what the user submitted. Advisory only: the reviewer decides. */
export default function OcrPrecheck({ ocr }: { ocr: OcrResult | null }) {
  if (!ocr) return null;
  const head = <p className="eyebrow flex items-center gap-1.5"><ScanText className="h-3.5 w-3.5" aria-hidden /> Automated pre-check</p>;
  if (ocr.status !== 'completed' || !ocr.data?.fields || !ocr.data.checks || ocr.score === null) {
    const msg = ocr.status === 'pending' ? 'Reading the document… refresh in a minute.'
      : ocr.status === 'skipped' ? `Not run${ocr.data?.reason ? `: ${ocr.data.reason}` : ''}.`
      : `Could not read the document${ocr.data?.reason ? ` (${ocr.data.reason})` : ''}. Review it manually.`;
    return <div className="mt-4 rounded-xl border border-neutral-200 p-3">{head}<p className="mt-1 text-sm text-neutral-600">{msg}</p></div>;
  }
  const { fields: f, checks: c } = ocr.data;
  const v = VERDICT[ocrVerdict(ocr.score)];
  const row = (label: string, value: string | null, check?: Check) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="font-mono text-neutral-900">{value ?? '—'}</span>
        {check && <span className={clsx('ml-2 text-xs font-medium', CHECK[check].tone)}>{CHECK[check].label}</span>}
      </dd>
    </div>
  );
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {head}
        <span className={clsx('pill', v.tone)}>{v.label} · {Math.round(ocr.score * 100)}%</span>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {row('Number on document', f.document_number, c.number)}
        {row(f.business_name ? 'Business name' : 'Name', f.business_name ?? f.full_name, c.name)}
        {row('Document type', f.document_type_detected.replace('_', ' '), c.type)}
        {f.issuing_country && row('Issuing country', f.issuing_country, c.country)}
        {f.expiry_date && row('Expires', f.expiry_date)}
      </dl>
      {(c.expired || !f.legible || f.issues.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-300">
          {c.expired && <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />The document has expired.</li>}
          {!f.legible && <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Text was hard to read.</li>}
          {f.issues.map((i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{i}</li>)}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">Read automatically; it can be wrong. Always compare with the image.</p>
    </div>
  );
}
