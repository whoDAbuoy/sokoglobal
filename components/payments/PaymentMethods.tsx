'use client';

import { useId, useState } from 'react';
import clsx from 'clsx';
import { Bitcoin, CreditCard, Globe2, Landmark, Smartphone, type LucideIcon } from 'lucide-react';
import {
  CATEGORY_LABEL, METHOD_CATEGORY, METHOD_LABEL, WIRE_SUGGESTED_CENTS, defaultMethod, groupByCategory,
  type CryptoOption, type ManualPaymentView, type PaymentCategory, type PaymentMethod, type SwiftDetails,
} from '@/lib/payment-methods';
import BankCardPanel from './BankCardPanel';
import GatewayRedirect from './GatewayRedirect';
import AirtelPay from './AirtelPay';
import { CryptoPanel, WireTransferPanel } from './ManualPayment';
import MpesaPay from '@/app/dashboard/orders/[id]/MpesaPay';

const CATEGORY_ICON: Record<PaymentCategory, LucideIcon> = { mobile: Smartphone, cards: CreditCard, global: Globe2, wire: Landmark, crypto: Bitcoin };

export interface ManualContext {
  buyerId: string; dueCents: number; open: ManualPaymentView | null; rejectedNote: string | null;
  swift: SwiftDetails; cryptoOptions: CryptoOption[]; cryptoMarkup: number;
}

/**
 * Checkout payment picker (migration 028): category tabs — Local Mobile Money, Cards & Pan-African,
 * Global Digital Payments, B2B Bank Wire, Crypto Escrow — showing only the methods the server says are
 * switched on and configured. Every method charges what Postgres says is due; nothing here sets an amount.
 */
export default function PaymentMethods({ target, methods, preferred, amountLabel, buyerName, manual }: {
  target: { kind: 'order' | 'group'; id: string };
  methods: PaymentMethod[];
  /** ?pay=… or the method of an open wire / crypto transfer. */
  preferred?: string | null;
  amountLabel: string;
  buyerName?: string;
  /** Wire / crypto context (single orders only). */
  manual?: ManualContext;
}) {
  const uid = useId();
  const groups = groupByCategory(methods);
  const openMethod: PaymentMethod | null = manual?.open ? (manual.open.method === 'swift_wire' ? 'swift_wire' : 'crypto') : null;
  const [method, setMethod] = useState<PaymentMethod | null>(defaultMethod(methods, openMethod ?? preferred));
  if (!groups.length || !method) {
    return <p className="text-sm text-neutral-600">Online payment isn&apos;t available right now. Please try again shortly or contact support.</p>;
  }
  const category = METHOD_CATEGORY[method];
  const active = groups.find((g) => g.category === category) ?? groups[0];
  const base = target.kind === 'order' ? `/api/orders/${target.id}` : `/api/checkout/${target.id}`;
  const returnPath = target.kind === 'order' ? `/dashboard/orders/${target.id}` : `/dashboard/checkout/${target.id}`;

  return (
    <div>
      <div role="tablist" aria-label="Payment category" className="segmented no-scrollbar overflow-x-auto">
        {groups.map((g) => {
          const Icon = CATEGORY_ICON[g.category];
          const selected = g.category === active.category;
          return (
            <button key={g.category} type="button" role="tab" id={`${uid}-tab-${g.category}`} aria-selected={selected} aria-controls={`${uid}-panel`}
              onClick={() => setMethod(g.methods.includes(method) ? method : g.methods[0])}
              className={clsx('segment flex-1 whitespace-nowrap', selected && 'text-neutral-900')}>
              <Icon className={clsx('h-4 w-4', selected ? 'text-blue-600 dark:text-cyan-400' : 'text-neutral-400')} aria-hidden /> {CATEGORY_LABEL[g.category]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active.category}`} className="glass-inset mt-4 p-4 sm:p-5">
        {active.methods.length > 1 ? (
          <div role="radiogroup" aria-label={CATEGORY_LABEL[active.category]} className="segmented mb-4 inline-flex">
            {active.methods.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className="segment py-1.5">
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        ) : <p className="eyebrow mb-3">{METHOD_LABEL[active.methods[0]]}</p>}
        {method === 'mpesa' && <MpesaPay orderId={target.id} endpoint={`${base}/mpesa`} onSwitchToCard={methods.includes('card') ? () => setMethod('card') : undefined} />}
        {method === 'airtel_money' && <AirtelPay endpoint={`${base}/gateway`} />}
        {method === 'card' && (
          <BankCardPanel endpoint={target.kind === 'order' ? `${base}/checkout` : `${base}/card`} amountLabel={amountLabel} returnPath={returnPath} defaultName={buyerName} />
        )}
        {method === 'dpo_pay' && <GatewayRedirect gateway="dpo" endpoint={`${base}/gateway`} amountLabel={amountLabel} />}
        {method === 'paypal' && <GatewayRedirect gateway="paypal" endpoint={`${base}/gateway`} amountLabel={amountLabel} />}
        {method === 'swift_wire' && manual && (
          <>
            {manual.dueCents >= WIRE_SUGGESTED_CENTS && !manual.open && <p className="mb-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">Recommended for orders of $5,000 and above.</p>}
            <WireTransferPanel orderId={target.id} buyerId={manual.buyerId} dueCents={manual.dueCents} open={manual.open}
              rejectedNote={manual.rejectedNote} swift={manual.swift} />
          </>
        )}
        {method === 'crypto' && manual && (
          <CryptoPanel orderId={target.id} buyerId={manual.buyerId} dueCents={manual.dueCents} open={manual.open}
            rejectedNote={manual.rejectedNote} options={manual.cryptoOptions} markup={manual.cryptoMarkup} />
        )}
      </div>
    </div>
  );
}
