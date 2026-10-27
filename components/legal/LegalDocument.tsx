import { LEGAL_ENTITY, LEGAL_EMAIL, legalEffectiveDate } from '@/lib/legal';

/** Shared frame for the legal pages: title, effective date, numbered sections with anchors. */
export function LegalDocument({ title, summary, children }: { title: string; summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="text-[15px] leading-relaxed text-neutral-700">
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">{LEGAL_ENTITY} · Effective {legalEffectiveDate()}</p>
      <div className="glass-card mt-6 p-5 text-sm text-neutral-700">{summary}</div>
      <div className="mt-8 space-y-8">{children}</div>
      <p className="mt-12 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
        Questions about this document: <a href={`mailto:${LEGAL_EMAIL}`} className="font-medium text-neutral-900 underline underline-offset-4">{LEGAL_EMAIL}</a>
      </p>
    </article>
  );
}

export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 space-y-3">
      <h2 id={`${id}-h`} className="text-lg font-semibold text-neutral-900">{n}. {title}</h2>
      {children}
    </section>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-neutral-400">{children}</ul>;
}
