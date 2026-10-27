import { getSessionProfile } from '@/lib/supabase/server';
import { needsTermsAcceptance } from '@/lib/legal';
import TermsPrompt from './TermsPrompt';

/**
 * In the buyer and supplier portals: accounts that have not accepted the current Terms of Trade, Escrow
 * Agreement and Privacy Policy (accounts from before they were published, or after an update) see a prompt
 * over the page until they accept. Reuses the request's cached session/profile read.
 */
export default async function TermsGate() {
  const { profile } = await getSessionProfile();
  return needsTermsAcceptance(profile) ? <TermsPrompt updated={!!profile?.terms_version} /> : null;
}
