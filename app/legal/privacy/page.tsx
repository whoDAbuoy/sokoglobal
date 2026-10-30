import type { Metadata } from 'next';
import { LegalDocument, List, Section } from '@/components/legal/LegalDocument';
import { LEGAL_EMAIL, LEGAL_ENTITY, LEGAL_STATE } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy · SokoGlobal',
  description: 'What personal data SokoGlobal collects, why, who it is shared with, how long it is kept, and your choices.',
  alternates: { canonical: '/legal/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" summary={<>
      <p><strong className="text-neutral-900">In short:</strong> we collect what we need to verify businesses, run orders and escrow, pay suppliers and keep the
        Platform secure. We do not sell personal data or use advertising trackers. Service providers process data for us under contract. You can ask for a copy,
        a correction or deletion at {LEGAL_EMAIL}.</p>
    </>}>
      <Section id="controller" n={1} title="Who is responsible">
        <p>{LEGAL_ENTITY}, a {LEGAL_STATE} limited liability company, is responsible for personal data processed through sokoglobal.shop (the “Platform”). Contact:{' '}
          {LEGAL_EMAIL}.</p>
      </Section>

      <Section id="collect" n={2} title="What we collect">
        <List>
          <li><strong className="text-neutral-900">Account:</strong> name, work email, password (stored hashed by our authentication provider), business name,
            country, role, job title, phone number, short bio, profile photo, and two-factor authentication settings.</li>
          <li><strong className="text-neutral-900">Verification (KYC):</strong> identity document (national ID or passport) and business document (licence or tax
            certificate) with their numbers; for Suppliers, legal name, tax and registration numbers, business address and payout bank details. Bank account
            numbers are stored encrypted.</li>
          <li><strong className="text-neutral-900">Orders and payments:</strong> orders, quotes, delivery address, shipment and tracking details, amounts, payment
            method, payment references, mobile-money number used, and wire or crypto transfer proofs. We do not see or store full card numbers.</li>
          <li><strong className="text-neutral-900">Communications:</strong> messages, attachments and voice notes in order chats and support, disputes, and ratings.</li>
          <li><strong className="text-neutral-900">Technical:</strong> IP address, browser and device information, and security logs (sign-ins, rate limits,
            admin actions with IP and browser).</li>
          <li><strong className="text-neutral-900">Activity on listings:</strong> which listings you open or save (at most one record per listing per day),
            used only to rank trending products. Other users only ever see totals, never who.</li>
        </List>
      </Section>

      <Section id="use" n={3} title="Why we use it">
        <List>
          <li>To provide the Platform and perform our contract with you: accounts, listings, orders, escrow, payouts, shipping, support and disputes.</li>
          <li>To verify businesses, prevent fraud and money laundering, screen sanctions, and keep the Platform secure (our legitimate interests and legal obligations).</li>
          <li>To meet legal, tax and accounting obligations and respond to lawful requests.</li>
          <li>To send service messages by email or SMS (order, payment and security notices). You can manage optional alerts in Settings.</li>
          <li>To improve the Platform using aggregated operational data. We do not profile you for advertising.</li>
        </List>
        <p>Where the EU/UK GDPR applies, our legal bases are contract, legitimate interests, legal obligation and, where we ask for it, consent.</p>
      </Section>

      <Section id="staff" n={4} title="Who at SokoGlobal can see it">
        <p>Authorised staff can see account, verification and order data, and can read order and support conversations, to verify accounts, provide support,
          resolve disputes and investigate fraud. Staff access to sensitive actions requires two-factor authentication and is logged.</p>
      </Section>

      <Section id="share" n={5} title="Who we share it with">
        <p>The other party to your order sees what they need for it (for example, the Supplier sees the Buyer’s business and delivery details; the Buyer sees the
          Supplier’s business profile). Public listing and supplier pages show business information only. We also use these service providers, who process data
          on our instructions:</p>
        <List>
          <li><strong className="text-neutral-900">Hosting and data:</strong> Supabase (database, authentication, file storage), Vercel (hosting, scheduled jobs),
            Upstash (rate limiting by account ID or IP).</li>
          <li><strong className="text-neutral-900">Payments and payouts:</strong> Paystack, PayPal, DPO Pay, Safaricom (M-Pesa), Airtel Money, Flutterwave
            (supplier payouts), and our banks. They receive what each payment needs (for example email, name, phone number, amount, payout bank details).</li>
          <li><strong className="text-neutral-900">Verification:</strong> Anthropic, which reads uploaded verification documents to pre-fill and check details for our
            reviewers. Staff make every decision.</li>
          <li><strong className="text-neutral-900">Shipping:</strong> DHL Express (rate quotes and tracking: addresses, weights, waybills).</li>
          <li><strong className="text-neutral-900">Communications:</strong> Resend (email), Africa’s Talking (SMS), Slack (internal alerts with order references, no
            contact details).</li>
          <li><strong className="text-neutral-900">Operations:</strong> Sentry (error reports, with emails, IPs and cookies removed), our CRM and workflow tools (business
            name, contact name and country; no email or phone), map tile providers (CARTO / OpenStreetMap) and video players (YouTube privacy-enhanced mode, Vimeo)
            when you view those features.</li>
        </List>
        <p>We disclose data when the law requires it, to protect rights and safety, or as part of a merger or sale of our business (the buyer would be bound by this
          policy). <strong className="text-neutral-900">We do not sell or rent personal data, and do not share it for cross-context behavioural advertising.</strong></p>
      </Section>

      <Section id="cookies" n={6} title="Cookies and local storage">
        <p>We use only what the Platform needs: authentication cookies that keep you signed in, a cookie that remembers your display currency, and browser storage for
          your theme, cart and a sign-in form draft. We do not use advertising or third-party analytics cookies, so there is nothing to opt out of; blocking these
          cookies will sign you out.</p>
      </Section>

      <Section id="retention" n={7} title="How long we keep it">
        <List>
          <li>Account and profile data: while the account is open, then deleted or anonymised within 90 days of closure, except as below.</li>
          <li>Orders, payments, payouts, invoices and related messages: 7 years after the order, for tax, accounting and anti-fraud obligations.</li>
          <li>Verification documents and data: 5 years after the account closes or the business relationship ends.</li>
          <li>Security and audit logs: up to 2 years; listing views and saves: 90 days; integration delivery logs: 30 days.</li>
        </List>
      </Section>

      <Section id="security" n={8} title="Security">
        <p>Data is encrypted in transit; bank account numbers and two-factor secrets are encrypted at rest; database access rules restrict every user to their own
          data; staff financial actions require two-factor authentication and are logged. No system is perfectly secure; if a breach affects you, we will notify you
          as the law requires.</p>
      </Section>

      <Section id="rights" n={9} title="Your choices and rights">
        <p>You can view and edit most of your data in Settings, download a copy of it (Settings → Security → Download my data), and close your account there
          (Settings → Security → Close account). You can also ask us to provide a copy, correct, delete or restrict use of your personal data, or object
          to processing, by writing to {LEGAL_EMAIL} from your account email. We may need to verify your identity, and we will keep data we are legally required to
          keep. We answer within 30 days (45 days where U.S. state law allows). We will not discriminate against you for exercising a right. Depending on where you
          live (for example California or another U.S. state with a privacy law, the EU or the UK), you may have additional rights, including to appeal our decision
          or complain to your data protection authority.</p>
      </Section>

      <Section id="transfers" n={10} title="International transfers">
        <p>SokoGlobal is based in the United States and our providers process data in the United States and other countries. Where EU/UK law applies, we rely on
          appropriate safeguards such as the European Commission’s Standard Contractual Clauses.</p>
      </Section>

      <Section id="business" n={11} title="Business users only">
        <p>The Platform is for businesses and is not directed at children under 18. We do not knowingly collect their data.</p>
      </Section>

      <Section id="changes" n={12} title="Changes">
        <p>We will post updates here with a new effective date, and notify account holders of material changes before they take effect.</p>
      </Section>
    </LegalDocument>
  );
}
