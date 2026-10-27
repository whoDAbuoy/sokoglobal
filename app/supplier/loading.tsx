import PageSkeleton from '@/components/layout/PageSkeleton';

/** Streams the shell and this placeholder at once; the page replaces it when its data is ready. */
export default function Loading() {
  return <PageSkeleton />;
}
