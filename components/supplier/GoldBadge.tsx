import clsx from 'clsx';
import { Crown } from 'lucide-react';

/**
 * "Gold Supplier" mark for suppliers with an active paid membership (migration 026).
 * It says the supplier pays for Gold — not that they are verified; the green
 * BadgeCheck stays the KYC "Verified" mark, and a supplier can show both.
 */
export default function GoldBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span title="Gold Supplier: a paid SokoGlobal membership" className={clsx('pill tone-gold gap-0.5 whitespace-nowrap font-semibold', compact ? 'px-1.5 py-0 text-[10px]' : 'text-[11px]', className)}>
      <Crown className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden /> Gold Supplier
    </span>
  );
}
