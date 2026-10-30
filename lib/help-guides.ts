/**
 * Help Center guides (app/help). Each guide is a short numbered how-to; `show` opens the page it describes with
 * its guided tour running (`?tour=<id>`, lib/tours.ts).
 */

export type Audience = 'buyer' | 'supplier';

export interface HelpGuide {
  id: string;
  audience: Audience;
  title: string;
  summary: string;
  steps: string[];
  /** Page + tour that walks through it on screen. */
  show?: { href: string; tour: string };
  /** Further reading. */
  more?: { href: string; label: string };
}

export const HELP_GUIDES: HelpGuide[] = [
  // ── Buyers ──
  {
    id: 'escrow', audience: 'buyer', title: 'How escrow protects your money',
    summary: 'You pay SokoGlobal, not the supplier. The supplier is paid only after you confirm the goods arrived as described.',
    steps: [
      'Place an order and pay. The money is held in escrow for that order.',
      'The supplier only now sees the order, and ships it with tracking.',
      'When the goods arrive, check them before confirming.',
      'Confirm delivery to release payment to the supplier, or open a dispute if anything is wrong. While a dispute is open, the money stays held.',
    ],
    show: { href: '/dashboard', tour: 'buyer-home' },
    more: { href: '/legal/escrow', label: 'Read the Escrow Agreement' },
  },
  {
    id: 'verify-buyer', audience: 'buyer', title: 'Verify your business',
    summary: 'A one-time check before your first order. Usually reviewed within a working day.',
    steps: [
      'Open Verification from the banner on your dashboard (or go to /dashboard/kyc).',
      'Upload an ID: national ID or passport.',
      'Upload a business document: trading licence or tax certificate. PDF, JPG or PNG, up to 10 MB.',
      'You will get a notification when you are approved, and can then order.',
    ],
    show: { href: '/dashboard/kyc', tour: 'buyer-kyc' },
  },
  {
    id: 'first-order', audience: 'buyer', title: 'Place your first Trial Batch',
    summary: 'A small first order from a supplier at one Guaranteed Landed Cost: goods, air freight and customs to your door.',
    steps: [
      'Open Catalog and search, or pick a category and filter by specification.',
      'Check the landed cost breakdown on the card: goods, freight and customs, and the price per unit.',
      'Choose how many batches, then tap Place order (or Add to cart to buy from several suppliers at once).',
      'On the order page, choose how to pay: card, mobile money, PayPal, bank wire and others where available.',
      'Track it under My Orders. Delivery usually takes the lead time shown on the card.',
    ],
    show: { href: '/dashboard/discover', tour: 'buyer-catalog' },
  },
  {
    id: 'track-confirm', audience: 'buyer', title: 'Track an order and confirm delivery',
    summary: 'Follow each order from payment to your door, then release payment when you are happy.',
    steps: [
      'Open My Orders and tap the order.',
      'The timeline shows payment, dispatch, customs and delivery as they happen, with the carrier’s tracking link.',
      'When it arrives, inspect the goods.',
      'Tap Confirm delivery to pay the supplier, or Open a dispute and describe the problem with photos.',
    ],
    show: { href: '/dashboard/orders', tour: 'buyer-orders' },
  },
  {
    id: 'dispute', audience: 'buyer', title: 'Something is wrong with an order',
    summary: 'Open a dispute before confirming delivery. The money stays in escrow until it is resolved.',
    steps: [
      'Open the order and choose Open a dispute.',
      'Pick the reason (not received, not as described, damaged, wrong quantity, counterfeit or other) and explain what happened.',
      'Add photos, videos and packing lists. Keep talking to the supplier in the order chat: it is part of the record.',
      'SokoGlobal reviews the evidence and decides: release to the supplier, or a full or partial refund to you.',
    ],
    more: { href: '/legal/escrow#disputes', label: 'How disputes are decided' },
  },
  {
    id: 'pools', audience: 'buyer', title: 'Buy together in a Trend Pool',
    summary: 'Share one bulk shipment with other boutiques and split the freight.',
    steps: [
      'Open Trend Pools. The pools with the most recent pledges are listed first.',
      'Open a pool and enter your pledge (at least the minimum shown). Your share of the freight is calculated for you.',
      'Pay your pledge by card. It is held in escrow.',
      'The pool ships once it reaches its target. If it misses the deadline, every pledge is refunded in full.',
    ],
    show: { href: '/dashboard/pools', tour: 'buyer-pools' },
  },
  {
    id: 'rfq', audience: 'buyer', title: 'Ask suppliers for a quote',
    summary: 'For volumes, grades or prices that are not listed.',
    steps: [
      'Open RFQs and tap New RFQ.',
      'Choose the category, describe the product, the quantity, your target price and where it should be delivered.',
      'Verified suppliers quote privately. Compare quotes under your request.',
      'Accept one to turn it into an escrow order, paid in full or 30% now and 70% when it ships.',
    ],
    show: { href: '/dashboard/rfqs', tour: 'buyer-rfqs' },
  },
  {
    id: 'security', audience: 'buyer', title: 'Keep your account safe',
    summary: 'Two-factor authentication, password changes, and your data.',
    steps: [
      'Go to Settings → Security.',
      'Turn on two-factor authentication with an authenticator app, and save the backup codes somewhere safe.',
      'Change your password there too. Forgot it? Use “Forgot password?” on the sign-in page.',
      'Download your data or close your account at the bottom of the same page.',
    ],
    show: { href: '/dashboard/settings?tab=security', tour: 'buyer-settings' },
  },

  // ── Suppliers ──
  {
    id: 'verify-supplier', audience: 'supplier', title: 'Get verified',
    summary: 'Listings go live and payouts are sent only after your business is verified.',
    steps: [
      'Open Verification.',
      'Upload your ID and a business document (licence or tax certificate).',
      'Add your legal company details and the bank account for payouts.',
      'We review within a working day. Changing the bank account later sends it back for review.',
    ],
    show: { href: '/supplier/verification', tour: 'supplier-verification' },
  },
  {
    id: 'first-listing', audience: 'supplier', title: 'Create your first listing',
    summary: 'A Trial Batch listing: your product, your price, a small first order for new buyers.',
    steps: [
      'Tap New product.',
      'Pick the category, then add the title, brand, description and at least 3 clear photos (beauty products also need a short swatch video).',
      'Set your unit price, lead time and Trial Batch size.',
      'Submit for review. Our team adds air freight and customs and publishes the Guaranteed Landed Cost buyers see.',
    ],
    show: { href: '/supplier/products/new', tour: 'supplier-new-listing' },
  },
  {
    id: 'ship', audience: 'supplier', title: 'Ship an order',
    summary: 'Every order you see is already paid into escrow, so it is safe to ship.',
    steps: [
      'Open Orders. New paid orders are under Ready to ship.',
      'Pack the goods and hand them to the carrier.',
      'Tap Fulfil & ship and enter the carrier and waybill number.',
      'Update the status as the parcel moves. The buyer confirms delivery at the end.',
    ],
    show: { href: '/supplier/orders', tour: 'supplier-orders' },
  },
  {
    id: 'payouts', audience: 'supplier', title: 'Getting paid',
    summary: 'You are paid the goods value, minus commission, when the buyer confirms delivery.',
    steps: [
      'When the buyer confirms delivery, the payout starts automatically to your verified bank account.',
      'Commission (5%, or 3% with Gold) is taken from the goods value; freight and customs are not yours to pay.',
      'Need the money sooner? After dispatch you can choose an early payout for a small extra fee.',
      'Payouts wait if your verification or bank account is not approved yet.',
    ],
    more: { href: '/legal/escrow#release', label: 'When suppliers are paid' },
  },
  {
    id: 'quote', audience: 'supplier', title: 'Win buyers with quotes',
    summary: 'Answer importers’ requests for quote privately.',
    steps: [
      'Open RFQs to see open buyer requests in your categories.',
      'Set your price, lead time and how long the quote is valid.',
      'Only the buyer sees your quote. If they accept, it becomes an escrow order.',
    ],
    show: { href: '/supplier/rfqs', tour: 'supplier-rfqs' },
  },
];

export const guidesFor = (audience: Audience) => HELP_GUIDES.filter((g) => g.audience === audience);

/** "Show me" link: the page with its tour starting (keeps any query the page already has). */
export function showMeHref(show: { href: string; tour: string }): string {
  return `${show.href}${show.href.includes('?') ? '&' : '?'}tour=${encodeURIComponent(show.tour)}`;
}

export const parseAudience = (v: unknown, fallback: Audience = 'buyer'): Audience => (v === 'buyer' || v === 'supplier' ? v : fallback);
