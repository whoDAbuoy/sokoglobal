import { notFound, redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ChatInbox from '@/components/chat/ChatInbox';

export const metadata = { title: 'Messages · SokoGlobal' };
export const dynamic = 'force-dynamic';

/** Buyer inbox: conversations with suppliers, one per product. */
export default async function BuyerMessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string | string[] }> }) {
  const { thread } = await searchParams;
  const threadId = typeof thread === 'string' && UUID_RE.test(thread) ? thread : null;
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) redirect(`/login?redirectTo=${encodeURIComponent(threadId ? `/dashboard/messages?thread=${threadId}` : '/dashboard/messages')}`);
  if (profile.role === 'supplier') redirect(threadId ? `/supplier/messages?thread=${threadId}` : '/supplier/messages');
  if (profile.role !== 'importer') notFound();

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow">Messages</p>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">Inbox</h1>
        <ChatInbox basePath="/dashboard/messages" initialThreadId={threadId} />
      </main>
    </>
  );
}
