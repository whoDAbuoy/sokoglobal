import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument, List, Section } from '@/components/legal/LegalDocument';
import { LEGAL_EMAIL, LEGAL_ENTITY } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Escrow Agreement · SokoGlobal',
  description: 'How SokoGlobal holds a buyer’s payment until delivery is confirmed, when the supplier is paid, and how disputes and refunds work.',
  alternates: { canonical: '/legal/escrow' },
};

export default function EscrowPage() {
  return (
    <LegalDocument title="Escrow Agreement" summary={<>
      <p><strong className="text-neutral-900">In short:</strong> the Buyer pays SokoGlobal. SokoGlobal holds the money for that order and does not pay the
        Supplier until the Buyer confirms the goods arrived as described. If something is wrong, the Buyer opens a dispute and the money stays put until it is
        resolved: released to the Supplier, or refunded in full or in part to the Buyer.</p>
    </>}>
      <Section id="scope" n={1} title="What this agreement covers">
        <p>This Escrow Agreement is part of the <Link href="/legal/terms" className="font-medium text-neutral-900 underline underline-offset-4">Terms of Trade</Link>{' '}
          and applies to every order paid through the Platform between a Buyer, a Supplier and {LEGAL_ENTITY} (“SokoGlobal”). Capitalised words have the meaning
          given in the Terms.</p>
      </Section>

      <Section id="agent" n={2} title="How the money is held">
        <List>
          <li>Each Supplier appoints SokoGlobal as its limited agent to receive payment from Buyers for orders on the Platform. A Buyer’s payment to SokoGlobal
            for an order counts as payment to the Supplier: once SokoGlobal confirms it, the Buyer’s obligation to pay the Supplier for that amount is fulfilled.</li>
          <li>SokoGlobal holds order funds in accounts with its payment providers and banks, records every order’s balance separately, and does not use them for its
            own operations. SokoGlobal is not a bank and funds do not earn interest for the Buyer or Supplier; any interest belongs to SokoGlobal.</li>
          <li>Funds are held in U.S. dollars. Non-USD payments are converted at the rate and spread shown before payment.</li>
        </List>
      </Section>

      <Section id="funding" n={3} title="When an order is funded">
        <List>
          <li>An order is <strong className="text-neutral-900">funded</strong> once SokoGlobal has confirmed the full payment with the payment provider (or, for
            bank wires and crypto, once staff have matched the transfer). Only then is the Supplier asked to ship.</li>
          <li>For orders paid in two parts, the 30% deposit is held from payment; the balance becomes due after dispatch. Nothing is released to the Supplier until
            the order is fully paid and delivery is confirmed.</li>
          <li>Unpaid orders expire (after 24 hours, or 14 days while a wire or crypto transfer is under review). A payment that arrives after expiry is not applied;
            it is reviewed and refunded.</li>
        </List>
      </Section>

      <Section id="release" n={4} title="When the Supplier is paid">
        <List>
          <li>The Supplier records dispatch (carrier and waybill) and delivery. The Buyer then inspects the goods and either <strong className="text-neutral-900">confirms
            delivery</strong> or opens a dispute.</li>
          <li>On the Buyer’s confirmation, SokoGlobal releases the goods value, less the Supplier’s commission, to the Supplier’s verified payout account.
            SokoGlobal keeps its fees as described in the Terms.</li>
          <li>If delivery is recorded and the Buyer neither confirms nor opens a dispute within 14 days, SokoGlobal may contact the Buyer and, on the carrier’s
            proof of delivery, release the funds to the Supplier.</li>
          <li>A payout waits if the Supplier’s verification or payout account is not approved; the funds stay held until it is.</li>
          <li>A Supplier may choose an early payout after dispatch for an extra fee. SokoGlobal then advances the payout at its own risk; the Buyer’s protection under
            this agreement is unchanged.</li>
        </List>
      </Section>

      <Section id="disputes" n={5} title="Disputes">
        <List>
          <li><strong className="text-neutral-900">Who and when:</strong> the Buyer may open a dispute from payment until it confirms delivery, for goods not received,
            not as described, damaged, wrong quantity, counterfeit, or another stated reason, with a description.</li>
          <li><strong className="text-neutral-900">Evidence:</strong> both sides should provide photos, video, packing lists, tracking, inspection reports and messages
            within 7 days of being asked. Messages on the Platform are part of the record.</li>
          <li><strong className="text-neutral-900">Decision:</strong> SokoGlobal reviews the evidence and aims to decide within 21 days of the dispute opening (longer when
            goods must be returned or inspected). Possible outcomes are release to the Supplier, a full refund, or a partial refund with the rest released.
            Where a return is required, the goods are returned at the cost of the party at fault before a refund is paid.</li>
          <li>SokoGlobal’s decision is final as to the funds it holds. It does not stop either party from pursuing the other directly for anything beyond those funds.</li>
        </List>
      </Section>

      <Section id="refunds" n={6} title="Refunds">
        <List>
          <li>Refunds are decided by authorised SokoGlobal staff (with two-factor authentication), are never more than the amount collected for the order, and are
            recorded in an audit log.</li>
          <li>Refunds go back to the original payment method where the provider allows it (mobile money refunds may be paid manually). Currency conversion and
            provider fees already incurred may not be recoverable.</li>
          <li>If an order is cancelled before the Supplier ships, or a group purchase (Trend Pool) misses its target, the Buyer is refunded in full.</li>
        </List>
      </Section>

      <Section id="holds" n={7} title="Holds and legal requirements">
        <p>SokoGlobal may delay or refuse a release or refund where it reasonably suspects fraud, a breach of the Terms, sanctions or legal exposure, or where a court,
          regulator or law requires it, and may share information with authorities as the law requires. During maintenance, nothing is released or charged.</p>
      </Section>

      <Section id="liability" n={8} title="SokoGlobal’s responsibility">
        <p>SokoGlobal is responsible for holding, releasing and refunding order funds as this agreement describes. SokoGlobal is not responsible for the goods
          themselves, for payment provider or bank failures outside its control, or for delays caused by incomplete information. SokoGlobal’s liability for an
          order is limited to the funds it holds or received for that order.</p>
      </Section>

      <Section id="contact" n={9} title="Questions about a held payment">
        <p>Use the support chat on the order, or write to {LEGAL_EMAIL} with the order reference.</p>
      </Section>
    </LegalDocument>
  );
}
