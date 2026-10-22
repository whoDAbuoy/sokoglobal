import { notFound, redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/auth/admin-access';
import { UUID_RE } from '@/lib/uploads';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import AdminChatCenter from '@/components/chat/AdminChatCenter';

export const metadata = { title: 'Messages · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Admin chat center (super admins only; 404 for everyone else). Order chats,
 * product inquiries and direct support threads across the platform; every
 * read and write is re-checked by RLS (migration 025).
 */
export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const { thread } = await searchParams;
  const { user, profile } = await getSessionProfile();
  if (!user || !profile) redirect('/login?redirectTo=/admin/messages');
  if (!isSuperAdmin(profile)) notFound();

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="eyebrow">Internal · Support</p>
        <h1 className="mt-2 text-2xl font-semibold text-neutral-900">Messages</h1>
        <p className="mb-5 mt-1 text-sm text-neutral-600">Every conversation on SokoGlobal. Messages you send are marked “System / Admin message” and the recipients are notified.</p>
        <AdminChatCenter initialThreadId={thread && UUID_RE.test(thread) ? thread : null} />
      </main>
    </>
  );
}
