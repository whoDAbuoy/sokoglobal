import TermsGate from '@/components/legal/TermsGate';

/**
 * Supplier portal shell (Sellsy-style): always dark, whatever the site theme.
 * `.dark` scopes the theme variables and every `dark:` variant to this subtree; `.sellsy` swaps in the
 * smoked charcoal cards and white pill controls (app/globals.css). The wrapper is transparent: the
 * pure-black canvas, mint waves and globe come from AmbientBackdrop (lib/theme `isSellsyRoute`). Pages keep their own data
 * loading, guards and DashboardHeader. TermsGate asks for acceptance of updated legal documents.
 */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark sellsy min-h-screen text-neutral-900">{children}<TermsGate /></div>;
}
