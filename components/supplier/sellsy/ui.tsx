import Link from 'next/link';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { EscrowStatus, ProductStatus } from '@/lib/types';
import { statusMeta, type Tone } from '@/lib/order-status';

/** Modular dark card with an optional title row (title left, quiet action right). */
export function Panel({ title, action, className, children, id, as: Tag = 'section' }: {
  title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode; id?: string;
  as?: 'section' | 'div' | 'article';
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <Tag id={id} aria-labelledby={title && headingId ? headingId : undefined} className={clsx('sx-card scroll-mt-32 p-5 sm:p-6', className)}>
      {(title || action) && (
        <div className="sx-card-head">
          {title && <h2 id={headingId} className="sx-card-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function ViewAll({ href, children = 'View all' }: { href: string; children?: React.ReactNode }) {
  return <Link href={href} className="sx-link">{children}</Link>;
}

/** Mint (up) / rose (down) growth pill, e.g. "+12%". Hidden when there is nothing to compare. */
export function GrowthPill({ pct, label = 'vs previous 30 days' }: { pct: number | null; label?: string }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={clsx('sx-pill', up ? 'sx-pill-mint' : 'sx-pill-rose')} title={label}>
      <Icon className="h-3 w-3" aria-hidden />{up ? '+' : '−'}{Math.abs(pct)}%<span className="sr-only"> {label}</span>
    </span>
  );
}

const TONE: Record<Tone, string> = {
  success: 'sx-pill-mint', escrow: 'sx-pill-blue', warning: 'sx-pill-amber', danger: 'sx-pill-rose', muted: 'sx-pill-muted',
};

/** Order status pill, supplier wording (the buyer's "Supplier paid" reads "Paid out" here). */
export function OrderStatusPill({ status, className }: { status: EscrowStatus; className?: string }) {
  const meta = statusMeta(status);
  const label = status === 'released' ? 'Paid out' : status === 'delivered_pending_verification' ? 'Buyer verifying' : meta.label;
  return <span className={clsx('sx-pill', TONE[meta.tone], className)}>{label}</span>;
}

const PRODUCT: Record<ProductStatus, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'sx-pill-mint' },
  pending_review: { label: 'In review', cls: 'sx-pill-amber' },
  draft: { label: 'Draft', cls: 'sx-pill-muted' },
  archived: { label: 'Archived', cls: 'sx-pill-muted' },
};

export function ProductStatusPill({ status, removed, className }: { status: ProductStatus; removed?: boolean; className?: string }) {
  const p = removed ? { label: 'Removed', cls: 'sx-pill-rose' } : PRODUCT[status] ?? PRODUCT.draft;
  return <span className={clsx('sx-pill', p.cls, className)}>{p.label}</span>;
}

/** Page title block used across the portal. */
export function PageHead({ eyebrow, title, children, actions }: {
  eyebrow?: string; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-medium uppercase tracking-eyebrow text-neutral-500">{eyebrow}</p>}
        <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-medium tracking-tight text-neutral-900">{title}</h1>
        {children && <div className="mt-1.5 max-w-2xl text-sm text-neutral-500">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
