/**
 * Guided tours (components/tour/TourRunner.tsx): short step-by-step walkthroughs of the buyer and supplier pages.
 * A step points at an element marked `data-tour="<target>"`; a step without a target is a centred card. Steps whose
 * element isn't on the page right now (an empty list, a button only some orders have) are skipped, so every tour
 * still reads well. Each tour plays once per browser and can be replayed from the Guide button or the Help Center
 * (`?tour=<id>`). Bump a tour's `version` after changing it materially so returning users see it again.
 */

export type TourRole = 'importer' | 'supplier';

export interface TourStep {
  /** `data-tour` value of the element to highlight; omitted → a centred card. */
  target?: string;
  title: string;
  body: string;
}

export interface Tour {
  id: string;
  version: number;
  role: TourRole;
  /** Pages it runs on: an exact path, or a pattern for dynamic routes. */
  match: string | RegExp;
  title: string;
  steps: TourStep[];
}

const GUIDE_STEP: TourStep = {
  target: 'tour-button',
  title: 'Help is always one tap away',
  body: 'Tap Guide to replay the tour for the page you are on, or open the Help Center for step-by-step guides.',
};

export const TOURS: Tour[] = [
  // ── Buyers ──────────────────────────────────────────────────────────────
  {
    id: 'buyer-home', version: 1, role: 'importer', match: '/dashboard', title: 'Your dashboard',
    steps: [
      { title: 'Welcome to SokoGlobal', body: 'Buy from verified suppliers in Europe, the Americas and Asia at one fixed landed price, with your payment held in escrow. This quick tour shows you around.' },
      { target: 'escrow-banner', title: 'Your money is protected', body: 'Every payment is held in escrow. The supplier is paid only after you confirm the goods arrived as described. If something is wrong, open a dispute and the money stays put.' },
      { target: 'buyer-overview', title: 'Everything at a glance', body: 'Orders in progress, quotes on your requests, notices and freight insights. Tap any card to go straight to it.' },
      { target: 'trial-batches', title: 'Start with a Trial Batch', body: 'A small first order to test a supplier. The Guaranteed Landed Cost covers the goods, air freight and customs to your door: no surprise fees.' },
      { target: 'pools-strip', title: 'Buy together in Trend Pools', body: 'Join other boutiques on one shipment, pledge your share and split the freight. If a pool misses its target, you are refunded in full.' },
      { target: 'section-nav', title: 'Find your way around', body: 'Catalog lists every product. RFQs let you ask suppliers for a price. Trend Pools shows what is moving, Following shows suppliers you follow, and Messages holds your chats.' },
      { target: 'orders-chip', title: 'Track your orders', body: 'My Orders shows every order, where it is on its journey and where your escrow money is.' },
      GUIDE_STEP,
    ],
  },
  {
    id: 'buyer-catalog', version: 1, role: 'importer', match: '/dashboard/discover', title: 'The catalogue',
    steps: [
      { target: 'catalog-search', title: 'Search everything', body: 'Search by product, brand or SKU. Results come only from KYC-verified suppliers.' },
      { target: 'catalog-categories', title: 'Browse by category', body: 'Pick a category to narrow the list. The number shows how many listings are inside.' },
      { target: 'catalog-filters', title: 'Filter by specification', body: 'Inside a category, filter by its specifications, such as grade, certification or size.' },
      { target: 'catalog-sort', title: 'Sort the results', body: 'Featured first, newest, or by landed cost from low to high and back.' },
      { target: 'product-view', title: 'Choose how products look', body: 'Detailed shows the full price breakdown on every card. Grid fits more on screen, List is the most compact. Your choice is remembered.' },
      { target: 'landed-cost', title: 'One price, delivered', body: 'The bar shows how the Guaranteed Landed Cost splits into goods, air freight and customs. Tap the i icons for details.' },
      { target: 'place-order', title: 'Order or add to cart', body: 'Choose the number of batches, then Place order to pay now, or Add to cart to check out several suppliers at once. You pay into escrow, never to the supplier directly.' },
    ],
  },
  {
    id: 'buyer-pools', version: 1, role: 'importer', match: '/dashboard/pools', title: 'Trend Pools',
    steps: [
      { title: 'What buyers are moving on', body: 'This page shows open Trend Pools and the products getting the most orders, pledges and questions right now.' },
      { target: 'pool-stats', title: 'Pools at a glance', body: 'How many pools are open, how much has been pledged and how many boutiques are buying together.' },
      { target: 'pool-sort', title: 'Sort the pools', body: 'Trending puts the pools with the most recent pledges first. You can also see the ones closing soonest, the most funded or the newest.' },
      { target: 'pool-card', title: 'Join a pool', body: 'Pledge any amount above the minimum. Your share of freight is worked out for you. The pool ships once it reaches its target; if it doesn’t by the deadline, you get a full refund.' },
      { target: 'trending-products', title: 'Trending products', body: 'Ranked by recent orders, pool pledges, questions to suppliers, saves and views, with newer activity counting more. The label on each card says why it is trending.' },
    ],
  },
  {
    id: 'buyer-orders', version: 1, role: 'importer', match: '/dashboard/orders', title: 'My orders',
    steps: [
      { title: 'All your orders', body: 'Every order you place lives here, grouped by where it is. Your payment stays in escrow until you confirm delivery.' },
      { target: 'order-groups', title: 'Jump to a group', body: 'Orders to pay, on the way, waiting for your confirmation, and finished. Tap a group to jump to it.' },
      { target: 'escrow-tracker', title: 'Follow each order', body: 'Each order shows its stage: paid into escrow, shipped, cleared customs, delivered. Open one for tracking, payment and support.' },
      { target: 'quick-reorder', title: 'Order again in one tap', body: 'Liked a supplier? Reorder a past Trial Batch at today’s price.' },
    ],
  },
  {
    id: 'buyer-order', version: 1, role: 'importer', match: /^\/dashboard\/orders\/[^/]+$/, title: 'An order',
    steps: [
      { target: 'escrow-tracker', title: 'Where your order is', body: 'The stage of this order and of your escrow money.' },
      { target: 'order-timeline', title: 'Every step, with dates', body: 'Payment, dispatch, customs and delivery as they happen. Tracking appears here once the supplier ships.' },
      { target: 'order-actions', title: 'What to do next', body: 'Pay here if the order is unpaid. When the goods arrive, check them, then confirm delivery to release payment to the supplier, or open a dispute if something is wrong.' },
      { target: 'order-chat', title: 'Talk to the supplier', body: 'Chat about this order. Keep the conversation here: it is the record we rely on in a dispute.' },
      { target: 'order-price', title: 'What you paid for', body: 'The landed cost breakdown, fees and the commercial invoice to download for customs and your records.' },
    ],
  },
  {
    id: 'buyer-rfqs', version: 1, role: 'importer', match: '/dashboard/rfqs', title: 'Requests for quote',
    steps: [
      { title: 'Ask suppliers for a price', body: 'Need a volume, grade or price that isn’t listed? Describe it once and verified suppliers quote you privately.' },
      { target: 'new-rfq', title: 'Create a request', body: 'Tap New RFQ, choose the category, quantity, target price and destination. You can add Featured or White-Glove sourcing for faster answers.' },
      { target: 'rfq-list', title: 'Compare quotes', body: 'Quotes appear under each request. Accept the best one to turn it into an escrow order, paid in full or 30% now and 70% when it ships.' },
    ],
  },
  {
    id: 'buyer-messages', version: 1, role: 'importer', match: '/dashboard/messages', title: 'Messages',
    steps: [
      { title: 'Your inbox', body: 'Chats with suppliers about products and orders, and with SokoGlobal support, all in one place.' },
      { target: 'messages-hub', title: 'Conversations', body: 'Pick a conversation to read and reply. You can send photos, files and voice notes, and mute a thread you don’t need alerts for.' },
    ],
  },
  {
    id: 'buyer-settings', version: 1, role: 'importer', match: '/dashboard/settings', title: 'Settings',
    steps: [
      { target: 'settings-tabs', title: 'Your account settings', body: 'Profile, Security (password, two-factor and your data), business details, notifications and appearance.' },
      { title: 'Turn on two-factor', body: 'Under Security, switch on two-factor authentication. Anyone who learns your password still can’t get in without the code from your phone.' },
    ],
  },
  {
    id: 'buyer-kyc', version: 1, role: 'importer', match: '/dashboard/kyc', title: 'Verification',
    steps: [
      { title: 'Verify your business', body: 'Before your first order we check your identity and your business, once. It protects you and the suppliers you buy from.' },
      { target: 'kyc-checklist', title: 'Two documents', body: 'Upload an ID (national ID or passport) and a business document (licence or tax certificate). PDF, JPG or PNG, up to 10 MB. We usually review within a working day.' },
    ],
  },

  // ── Suppliers ───────────────────────────────────────────────────────────
  {
    id: 'supplier-home', version: 1, role: 'supplier', match: '/supplier', title: 'Your supplier portal',
    steps: [
      { title: 'Welcome to your portal', body: 'Sell to verified importers across Africa. Buyers pay into escrow before you ship, and you are paid when they confirm delivery.' },
      { target: 'new-product', title: 'List a product', body: 'Create a listing with photos, a price and a Trial Batch size. Our team adds freight and customs and publishes the Guaranteed Landed Cost buyers see.' },
      { target: 'supplier-kpis', title: 'Your numbers', body: 'Orders, what is ready to ship and how sales are moving. Ready to ship means the buyer has paid into escrow: send it out.' },
      { target: 'supplier-analytics', title: 'Analytics', body: 'Sales over time, best-selling products and categories, and when your orders come in.' },
      { target: 'gold', title: 'SokoGlobal Gold', body: 'Gold lowers your commission and adds a badge buyers trust. Optional, month to month.' },
      { target: 'section-nav', title: 'Your workspace', body: 'Products, inventory, orders to ship, returns, drafts, buyer requests (RFQs), messages and verification.' },
      GUIDE_STEP,
    ],
  },
  {
    id: 'supplier-products', version: 1, role: 'supplier', match: '/supplier/products', title: 'Products',
    steps: [
      { target: 'new-product', title: 'Add a listing', body: 'Start a new listing. You can also import many at once from a spreadsheet.' },
      { target: 'product-list', title: 'Your listings', body: 'Each listing shows its status: draft, in review, live or archived. Edit price, stock and photos any time; changes to a live listing are reviewed again.' },
    ],
  },
  {
    id: 'supplier-new-listing', version: 1, role: 'supplier', match: '/supplier/products/new', title: 'New listing',
    steps: [
      { title: 'Create a listing', body: 'Four short sections. Save a draft any time and finish later.' },
      { target: 'listing-category', title: 'Category', body: 'The category decides which specifications buyers can filter by. Regulated categories need permits or certificates at review.' },
      { target: 'listing-product', title: 'Product', body: 'Title, brand, description and at least 3 clear photos. Beauty products also need a short swatch video.' },
      { target: 'listing-pricing', title: 'Pricing and supply', body: 'Your unit price, lead time and Trial Batch size. You set the goods price; we add air freight and customs to make the Guaranteed Landed Cost. You are paid the goods value, minus commission, after the buyer confirms delivery.' },
    ],
  },
  {
    id: 'supplier-orders', version: 1, role: 'supplier', match: '/supplier/orders', title: 'Orders',
    steps: [
      { title: 'Orders to fulfil', body: 'You only see orders the buyer has paid into escrow, so every order here is safe to ship.' },
      { target: 'supplier-orders-table', title: 'Ship an order', body: 'Tap Fulfil & ship, enter the carrier and waybill, and keep tracking up to date. Once the buyer confirms delivery, your payout is sent to your verified bank account.' },
    ],
  },
  {
    id: 'supplier-verification', version: 1, role: 'supplier', match: '/supplier/verification', title: 'Verification',
    steps: [
      { title: 'Get verified to sell and be paid', body: 'We verify your identity, your business and your payout bank account once. Listings go live and payouts are sent only after approval.' },
      { target: 'kyc-workspace', title: 'Upload and fill in', body: 'Add your ID and business documents, your company details and the bank account for payouts. Changing the bank account later sends it back for review.' },
    ],
  },
  {
    id: 'supplier-rfqs', version: 1, role: 'supplier', match: '/supplier/rfqs', title: 'Buyer requests',
    steps: [
      { title: 'Win new buyers', body: 'Importers describe what they need; you quote privately. Only the buyer sees your quote.' },
      { target: 'rfq-list', title: 'Send a quote', body: 'Open a request, set your price, lead time and how long the quote is valid. If the buyer accepts, it becomes an escrow order like any other.' },
    ],
  },
];

const TOUR_ROLES: readonly string[] = ['importer', 'supplier'];

/** The tour for this page and role, or null. */
export function tourFor(pathname: string, role: string | null | undefined): Tour | null {
  if (!role || !TOUR_ROLES.includes(role)) return null;
  return TOURS.find((t) => t.role === role && (typeof t.match === 'string' ? t.match === pathname : t.match.test(pathname))) ?? null;
}

export const tourById = (id: string | null | undefined): Tour | null => TOURS.find((t) => t.id === id) ?? null;

/** localStorage key that records a finished or skipped tour (a new version shows again). */
export const tourSeenKey = (t: Pick<Tour, 'id' | 'version'>) => `sg-tour:${t.id}:v${t.version}`;
