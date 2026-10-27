import { PublicHeader } from '@/components/public/PublicCatalog';
import LegalNav from '@/components/legal/LegalNav';

/** Terms of Trade, Escrow Agreement and Privacy Policy: public, always dark like the catalogue pages. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark sellsy min-h-screen text-neutral-900">
      <PublicHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <LegalNav />
        {children}
      </div>
    </div>
  );
}
