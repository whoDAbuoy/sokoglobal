'use client';

import { useOptimistic, useTransition } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canFollow } from '@/lib/follows';
import { setFollow } from '@/app/dashboard/suppliers/actions';
import { setFollowed, useFollows } from './useFollows';

/**
 * Follow / Following toggle for a supplier. Flips at once (useOptimistic), then the
 * server action writes the row under RLS; if Postgres refuses, the button flips back
 * and says why. Hidden on your own account and on sample listings.
 */
export default function FollowButton({ supplierId, supplierName, initialFollowing, isDemo, size = 'md', className }: {
  supplierId: string;
  supplierName?: string;
  /** What the server page already knows (avoids a flash before the shared read lands). */
  initialFollowing?: boolean;
  isDemo?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { user } = useAuth();
  const { isFollowing } = useFollows();
  const confirmed = isFollowing(supplierId, initialFollowing ?? false);
  const [following, setOptimistic] = useOptimistic(confirmed, (_: boolean, next: boolean) => next);
  const [pending, startTransition] = useTransition();
  if (!canFollow(supplierId, user?.id, isDemo)) return null;

  const toggle = () => startTransition(async () => {
    const next = !following;
    setOptimistic(next);
    const r = await setFollow(supplierId, next);
    setFollowed(supplierId, r.following);
    if (!r.ok) toast.error(r.message);
    else if (next) toast.success(`Following ${supplierName ?? 'this supplier'}`, { description: 'Their new listings appear on your dashboard.' });
  });

  const label = supplierName ? `${following ? 'Unfollow' : 'Follow'} ${supplierName}` : undefined;
  return (
    <button type="button" onClick={toggle} aria-pressed={following} aria-label={label} aria-busy={pending || undefined}
      className={clsx('glass-button', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-4 text-sm', following && 'glass-button-active', className)}>
      {following
        ? <Check className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2.25} aria-hidden />
        : <Plus className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2.25} aria-hidden />}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
