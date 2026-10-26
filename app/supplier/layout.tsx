/**
 * Supplier portal shell (Sellsy-style): always dark, whatever the site theme.
 * `.dark` scopes the theme variables and every `dark:` variant to this subtree; `.sellsy` swaps in the
 * pure-black canvas, charcoal cards and white pill controls (app/globals.css). Pages keep their own data
 * loading, guards and DashboardHeader; this wrapper is presentation only.
 */
export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark sellsy min-h-screen text-neutral-900">{children}</div>;
}
