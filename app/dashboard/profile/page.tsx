import { redirect } from 'next/navigation';
import { parseSettingsTab } from '@/lib/settings';

/** The profile page moved into the settings hub; old links (?tab=account|security|appearance) keep working. */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(`/dashboard/settings?tab=${parseSettingsTab(tab)}`);
}
