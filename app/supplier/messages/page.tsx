import { notFound, redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MessagingHub from '@/components/chat/MessagingHub';
import { roleAdminLevel } from '@/lib/auth/admin-access';

export const metadata = { title: 'Messages · SokoGlobal' };
export const dynamic = 'force-dynamic';

/** Supplier inbox: buyer questions about the supplier's products. */
export default async function SupplierMessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string | string[] }> }) {
  const { thread } = await searchParams;
  const threadId = typeof thread === 'string' && UUID_RE.test(thread) ? thread : null;
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=${encodeURIComponent(threadId ? `/supplier/messages?thread=${threadId}` : '/supplier/messages')}`);
  if (roleAdminLevel(profile.role)) notFound();
  if (profile.role !== 'supplier') redirect(threadId ? `/dashboard/messages?thread=${threadId}` : '/dashboard/messages');

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="eyebrow">Messages</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Inbox</h1>
        <MessagingHub basePath="/supplier/messages" role="supplier" initialThreadId={threadId} />
      </main>
    </>
  );
}
