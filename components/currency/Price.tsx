'use client';

import { useCurrency } from '@/context/CurrencyContext';
import { formatUSD } from '@/lib/format';

/**
 * A price in the visitor's display currency. Amounts are USD cents (escrow) or
 * KES (RFQ prices). Converted amounts carry "≈" and the source amount as a
 * tooltip, because the charge itself is always computed from the USD amount.
 */
export default function Price({ cents, kes, className, approx = true }: {
  cents?: number; kes?: number; className?: string;
  /** Prefix converted amounts with "≈" (default). */
  approx?: boolean;
}) {
  const { currency, formatUsd, formatKes } = useCurrency();
  const native = cents !== undefined ? currency === 'USD' : currency === 'KES';
  const text = cents !== undefined ? formatUsd(cents) : formatKes(kes ?? 0);
  const source = cents !== undefined ? formatUSD(cents, true) : `KES ${(kes ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return (
    <span className={className} title={native ? undefined : `${source} at today's display rate`}>
      {!native && approx ? '≈ ' : ''}{text}
    </span>
  );
}

/** "≈ UGX 2,098,932 in your currency" under a USD charge; nothing when the visitor already sees USD. */
export function LocalPreview({ cents, className }: { cents: number; className?: string }) {
  const { currency, formatUsd } = useCurrency();
  if (currency === 'USD') return null;
  return <span className={className}>≈ {formatUsd(cents)} in {currency} at today&apos;s rate</span>;
}
