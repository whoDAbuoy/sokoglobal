'use client';

import { useActionState, useState, startTransition } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, XCircle } from 'lucide-react';
import { importListings, type ImportState } from '../actions';

/** Preview → import. The file stays selected between the two steps (submitted manually, not via form reset). */
export default function ImportWorkspace({ categories }: { categories: { slug: string; label: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, dispatch, pending] = useActionState<ImportState, FormData>(importListings, null);
  const [lastMode, setLastMode] = useState<'preview' | 'commit'>('preview');

  const send = (mode: 'preview' | 'commit') => {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    fd.set('mode', mode);
    setLastMode(mode);
    startTransition(() => dispatch(fd));
  };
  const okRows = state?.rows?.filter((r) => r.ok).length ?? 0;
  const committed = state?.mode === 'commit';

  return (
    <div className="mt-6 space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-neutral-900"><FileSpreadsheet className="h-4 w-4 text-neutral-500" aria-hidden /> 1. Prepare your sheet</h2>
          <a href="/supplier/products/import/template" className="btn-secondary px-3 py-2 text-sm"><Download className="h-4 w-4" aria-hidden /> Download template</a>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-700">
          <li><strong>Required:</strong> category, title, unit_price_usd, trial_units (or moq).</li>
          <li><strong>category</strong> is a slug (<code className="font-mono">vanilla-beans</code>) or a path (<code className="font-mono">Agriculture &gt; Spices &amp; Herbs</code>).</li>
          <li>Volume pricing: <code className="font-mono">tier1_min_qty</code> + <code className="font-mono">tier1_unit_price_usd</code>, up to tier {3}.</li>
          <li>Attributes: a column per field (<code className="font-mono">attr:grade</code>, <code className="font-mono">attr:harvest_year</code>), or <code className="font-mono">attributes</code> as <code className="font-mono">key=value; key=value</code>.</li>
        </ul>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-blue-700 dark:text-cyan-300">Category slugs ({categories.length})</summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-neutral-700 sm:grid-cols-2">
            {categories.map((c) => <li key={c.slug}><code className="font-mono text-neutral-900">{c.slug}</code> · {c.label}</li>)}
          </ul>
        </details>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-neutral-900"><UploadCloud className="h-4 w-4 text-neutral-500" aria-hidden /> 2. Upload and check</h2>
        <label htmlFor="import-file" className="label mt-3">CSV or Excel (.xlsx), up to 2 MB</label>
        <input id="import-file" type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm" />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => send('preview')} disabled={!file || pending} className="btn-secondary px-4 py-2">
            {pending && lastMode === 'preview' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Check file
          </button>
          <button type="button" onClick={() => send('commit')} disabled={!file || pending || !state?.rows || okRows === 0 || committed} className="btn-primary px-4 py-2">
            {pending && lastMode === 'commit' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Import {okRows || ''} valid row{okRows === 1 ? '' : 's'} as drafts
          </button>
        </div>
        {state && (
          <p role="status" className={clsx('mt-4 text-sm', state.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
            {state.message} {committed && state.created ? <Link href="/supplier" className="font-medium underline">Go to your catalogue</Link> : null}
          </p>
        )}
      </section>

      {state?.rows && state.rows.length > 0 && (
        <section className="card overflow-hidden" aria-label="Row results">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-600">
              <tr><th scope="col" className="px-4 py-3 font-semibold">Line</th><th scope="col" className="px-4 py-3 font-semibold">Product</th><th scope="col" className="px-4 py-3 font-semibold">Result</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {state.rows.map((r) => (
                <tr key={r.line} className="align-top">
                  <td className="px-4 py-2.5 tabular-nums text-neutral-600">{r.line}</td>
                  <td className="px-4 py-2.5 font-medium text-neutral-900">{r.title}</td>
                  <td className="px-4 py-2.5">
                    {r.ok ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden /> {committed ? 'Created' : 'Ready'}</span>
                    ) : (
                      <ul className="space-y-0.5 text-rose-700 dark:text-rose-400">
                        {r.errors.map((e) => <li key={e} className="flex items-start gap-1"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {e}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
