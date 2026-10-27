import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, List, Section } from '@/components/legal/LegalDocument';
import { LEGAL_EMAIL, LEGAL_ENTITY, LEGAL_STATE } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Trade · SokoGlobal',
  description: 'The rules for buying and selling on SokoGlobal: accounts, listings, Trial Batch orders, fees, shipping, disputes and liability.',
  alternates: { canonical: '/legal/terms' },
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Trade" summary={<>
      <p><strong className="text-neutral-900">In short:</strong> SokoGlobal is a marketplace. Suppliers sell goods to business buyers (importers) at one fixed
        landed price that includes freight and customs. Buyers pay SokoGlobal, which holds the money under the{' '}
        <Link href="/legal/escrow" className="font-medium text-neutral-900 underline underline-offset-4">Escrow Agreement</Link> until the buyer confirms
        delivery, then pays the supplier. These terms apply to every account and every order.</p>
    </>}>
      <Section id="parties" n={1} title="Who we are and who these terms apply to">
        <p>These Terms of Trade (the “Terms”) are a contract between you and {LEGAL_ENTITY}, a {LEGAL_STATE} limited liability company (“SokoGlobal”,
          “we”, “us”). They govern your use of sokoglobal.shop and its services (the “Platform”). The Escrow Agreement and the{' '}
          <Link href="/legal/privacy" className="font-medium text-neutral-900 underline underline-offset-4">Privacy Policy</Link> form part of these Terms.</p>
        <p>The Platform is for businesses only. By opening an account you confirm that you are at least 18, that you act for a business (not as a consumer),
          and that you are authorised to bind that business. “Buyer” or “Importer” means an account that buys; “Supplier” means an account that lists and sells.</p>
      </Section>

      <Section id="role" n={2} title="Our role">
        <p>SokoGlobal provides the marketplace, price quotation for freight and customs, payment collection, escrow holding, order tracking and support.
          The contract of sale for goods is between the Buyer and the Supplier. SokoGlobal is not the seller of the goods, does not take title to them, and
          does not manufacture, inspect or warehouse them, unless we expressly agree otherwise in writing for a specific order.</p>
        <p>We are not a bank, money transmitter, customs broker or freight forwarder. Payments are processed by third-party payment providers (Section 7).</p>
      </Section>

      <Section id="accounts" n={3} title="Accounts, verification and security">
        <List>
          <li>Give accurate, current information and keep it up to date. Changes to your name or business name are reviewed before they take effect.</li>
          <li>We verify businesses (“KYC”): an identity document and a business document (licence or tax certificate), and for Suppliers, tax and payout bank details.
            We may require verification before you list, order or receive payouts, and may refuse or revoke verification.</li>
          <li>Keep your password secret. Turn on two-factor authentication; staff accounts with financial permissions must use it. You are responsible for activity under your account.</li>
          <li>One business per account unless we agree otherwise. Accounts are not transferable.</li>
        </List>
      </Section>

      <Section id="listings" n={4} title="Listings and Trial Batches">
        <List>
          <li>Suppliers list goods as Trial Batches: a fixed quantity at a fixed price. Each listing is reviewed before it goes live; we may reject, edit
            presentation of, or remove listings.</li>
          <li>The Supplier sets the goods price. SokoGlobal quotes air freight and customs clearance at review and publishes the total as the
            <strong className="text-neutral-900"> Guaranteed Landed Cost</strong>: goods, freight and customs to the Buyer’s address. The freight quote includes
            a logistics margin retained by SokoGlobal.</li>
          <li>“Guaranteed” means the Buyer is never charged more than the Guaranteed Landed Cost shown at checkout for that order, plus the escrow fee and any
            currency conversion disclosed at payment. If the actual freight or customs cost differs from the quote, the difference is not passed to the Buyer.</li>
          <li>Suppliers warrant that their listings are accurate (photos, specifications, quantities, origin), that they own or may sell the goods, and that
            the goods meet the laws of the origin and destination countries, including labelling, safety and import rules for regulated categories.</li>
          <li>Duty and landed-cost calculators and carrier rate comparisons on the Platform are estimates for information only.</li>
        </List>
      </Section>

      <Section id="prohibited" n={5} title="Prohibited goods and conduct">
        <p>You may not list, buy or ship, or use the Platform to arrange:</p>
        <List>
          <li>counterfeit, pirated or infringing goods; stolen goods;</li>
          <li>weapons, ammunition and their parts; explosives; controlled drugs and drug paraphernalia; prescription medicines;</li>
          <li>hazardous materials that may not travel by air; live animals; human remains or body parts; endangered species or products made from them;</li>
          <li>goods subject to U.S. or other applicable sanctions, embargoes or export controls, or trade with persons on a sanctions list;</li>
          <li>anything illegal in the origin or destination country, or that requires a permit you do not hold.</li>
        </List>
        <p>You also may not: arrange payment outside the Platform for an order started on it; misrepresent goods, origin or identity; harass other users;
          scrape, overload or probe the Platform; or interfere with its security. We may remove content, cancel orders, freeze funds held for an order under
          the Escrow Agreement, and suspend or close accounts that break these rules, and report illegal activity to the authorities.</p>
      </Section>

      <Section id="orders" n={6} title="Orders">
        <List>
          <li>An order is placed when the Buyer completes checkout. It becomes binding on both sides when payment is confirmed and the order is funded in escrow.</li>
          <li>Unpaid orders are cancelled automatically after 24 hours, or after 14 days while a bank wire or crypto transfer is pending review.</li>
          <li>Eligible orders (USD 1,000 or more, verified Buyer) may be paid in two parts: a 30% deposit, and the balance once the Supplier has dispatched.
            The Supplier is paid only after the full amount is collected and delivery is confirmed.</li>
          <li>Suppliers must dispatch promptly, enter the carrier and waybill on the Platform, and keep tracking up to date.</li>
          <li>Requests for quotation (RFQs) and quotes are invitations to deal; a quote becomes an order only when the Buyer accepts and pays it.</li>
        </List>
      </Section>

      <Section id="fees" n={7} title="Prices, fees and payment">
        <List>
          <li><strong className="text-neutral-900">Buyers</strong> pay the Guaranteed Landed Cost plus an escrow fee (currently 2% of goods, freight and customs),
            shown before payment. Charges in a currency other than USD include a currency conversion spread (currently 1%), shown before payment.
            Crypto payments carry a handling fee shown before payment; bank wires carry none from us (your bank may charge).</li>
          <li><strong className="text-neutral-900">Suppliers</strong> pay a commission on the goods value (currently 5%, or 3% with Gold Supplier), fixed when
            the order is placed and deducted from the payout. An optional early payout after dispatch costs an additional fee shown before you choose it.
            Payouts are made in USD or converted to your payout currency at the payment provider’s rate.</li>
          <li><strong className="text-neutral-900">Gold Supplier</strong> is a paid plan (currently USD 49 for one month), paid in advance by card. It does not
            renew automatically. Paid add-ons for RFQs (Featured, White-Glove Sourcing) are charged when bought. Plan and add-on fees are non-refundable
            except where the law requires otherwise or we fail to provide the service.</li>
          <li>We may change fees for future orders and purchases by posting them on the Platform; changes never apply to an order already placed.</li>
          <li>Payments are processed by providers including Paystack, PayPal, DPO Pay, Safaricom M-Pesa, Airtel Money and our banks, under their own terms.
            Which methods are offered can change at any time.</li>
          <li>Each party is responsible for its own taxes, except the customs duties and taxes included in the Guaranteed Landed Cost.</li>
        </List>
      </Section>

      <Section id="shipping" n={8} title="Shipping, delivery and risk">
        <List>
          <li>Trial Batches are delivered duty paid (DDP) to the Buyer’s address: the Guaranteed Landed Cost covers carriage and import clearance.</li>
          <li>Risk of loss or damage stays with the Supplier until the goods are delivered to the Buyer’s address. Suppliers should insure shipments.</li>
          <li>The Buyer must inspect the goods promptly on arrival and either confirm delivery or open a dispute (Section 9).</li>
          <li>Delivery dates are estimates. Customs inspections, carrier delays and events outside a party’s control may delay delivery.</li>
        </List>
      </Section>

      <Section id="disputes" n={9} title="Problems with an order">
        <p>If goods are not received, not as described, damaged, short, counterfeit or otherwise wrong, the Buyer opens a dispute on the order before confirming
          delivery. While a dispute is open, the money stays in escrow. Disputes are handled under the Escrow Agreement, which explains evidence, timelines and
          outcomes (release, full or partial refund). Once the Buyer confirms delivery the Supplier is paid and the order can no longer be disputed on the Platform.</p>
      </Section>

      <Section id="reviews" n={10} title="Ratings and content">
        <p>Buyers with a completed order may rate the Supplier. Ratings must be honest and based on the transaction. You keep ownership of the content you upload
          (photos, videos, descriptions, messages); you give SokoGlobal a worldwide, royalty-free licence to host, display, adapt for display, and use it to operate
          and promote the Platform while it is on the Platform. Do not upload content you have no right to share.</p>
      </Section>

      <Section id="messages" n={11} title="Messages and support">
        <p>Messages on the Platform are kept with the order and may be read by SokoGlobal staff to provide support, resolve disputes, prevent fraud and enforce these
          Terms. Keep order communication on the Platform: it is the record we rely on in a dispute.</p>
      </Section>

      <Section id="ip" n={12} title="The Platform">
        <p>The Platform, its software, design and brand belong to SokoGlobal. You may use it only as these Terms allow. We may change, suspend or discontinue features.
          We aim to keep the Platform available but do not promise uninterrupted service; during maintenance, funds held in escrow are not released or charged.</p>
      </Section>

      <Section id="liability" n={13} title="Disclaimers and limits of liability">
        <p>Except as stated in these Terms and the Escrow Agreement, the Platform is provided “as is”. SokoGlobal does not guarantee the quality, safety, legality or
          conformity of goods, which is the Supplier’s responsibility, or any Buyer’s ability to pay.</p>
        <p>To the extent the law allows: (a) SokoGlobal is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits,
          revenue or business opportunity; and (b) SokoGlobal’s total liability arising from any order is limited to the amount SokoGlobal holds or received for
          that order, and for anything else to the fees you paid SokoGlobal in the 12 months before the claim. Nothing limits liability that cannot be limited by law,
          including for fraud or wilful misconduct.</p>
      </Section>

      <Section id="indemnity" n={14} title="Your responsibility to us">
        <p>You will defend and indemnify SokoGlobal against third-party claims, fines and costs arising from your goods, your listings or content, your breach of these
          Terms, or your violation of law or third-party rights.</p>
      </Section>

      <Section id="termination" n={15} title="Suspension and closing accounts">
        <p>You may ask us to close your account at any time ({LEGAL_EMAIL}). We may suspend or close an account for breach of these Terms, suspected fraud, a legal
          requirement, or inactivity. Open orders are completed or refunded under the Escrow Agreement first. Records we must keep by law (orders, payments, payouts,
          verification) are retained as the Privacy Policy describes.</p>
      </Section>

      <Section id="law" n={16} title="Governing law and disputes with SokoGlobal">
        <p>These Terms are governed by the laws of the State of {LEGAL_STATE} and applicable U.S. federal law, without regard to conflict-of-laws rules. The United
          Nations Convention on Contracts for the International Sale of Goods does not apply to these Terms.</p>
        <p>Before starting proceedings, contact us at {LEGAL_EMAIL} and allow 30 days to resolve the matter. Any claim against SokoGlobal that is not resolved
          must be brought in the state or federal courts located in {LEGAL_STATE}, and you consent to their jurisdiction. Claims must be brought individually,
          not as a class or representative action. Either party may seek urgent injunctive relief in any competent court.</p>
      </Section>

      <Section id="changes" n={17} title="Changes to these Terms">
        <p>We may update these Terms. We will post the new version with its effective date and, for material changes, notify account holders at least 14 days
          before they take effect. Orders placed before the change remain under the version in force when they were placed. Continuing to use the Platform after
          a change takes effect means you accept it.</p>
      </Section>

      <Section id="general" n={18} title="General">
        <p>These Terms, the Escrow Agreement and the Privacy Policy are the entire agreement between you and SokoGlobal about the Platform. If a provision is
          unenforceable, the rest remains in effect. Not enforcing a right is not a waiver. You may not assign these Terms without our consent; we may assign them
          to a successor of our business. Notices to you go to your account email; notices to us go to {LEGAL_EMAIL}. These Terms are written in English, which
          prevails over any translation.</p>
      </Section>
    </LegalDocument>
  );
}
