/**
 * Public listing / supplier pages (migration 036): always dark, like the portals (lib/theme SELLSY_ROOTS).
 * Transparent on purpose: AmbientBackdrop paints the #050505 canvas and mint waves behind it.
 */
export default function PublicCatalogLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark sellsy min-h-screen text-neutral-900">{children}</div>;
}
