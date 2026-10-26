/**
 * Buyer / importer shell (Sellsy layout): always dark, like the supplier portal (app/supplier/layout.tsx).
 * `.dark` scopes the theme variables and every `dark:` variant; `.sellsy` swaps in the charcoal glass cards,
 * white pill controls and mint accents (app/globals.css). Transparent on purpose: AmbientBackdrop paints the
 * #050505 canvas, mint waves and globe behind it. Pages keep their own data loading, guards and DashboardHeader.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark sellsy min-h-screen text-neutral-900">{children}</div>;
}
