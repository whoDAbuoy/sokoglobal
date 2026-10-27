import TermsGate from '@/components/legal/TermsGate';

/** Shared RFQ pages sit in the buyer / supplier Sellsy shell (see app/dashboard/layout.tsx). */
export default function RfqLayout({ children }: { children: React.ReactNode }) {
  return <div className="dark sellsy min-h-screen text-neutral-900">{children}<TermsGate /></div>;
}
