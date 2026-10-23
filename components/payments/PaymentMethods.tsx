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
      <div role="tablist" aria-label="Payment category" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
        {groups.map((g) => {
          const Icon = CATEGORY_ICON[g.category];
          const selected = g.category === active.category;
          return (
            <button key={g.category} type="button" role="tab" id={`${uid}-tab-${g.category}`} aria-selected={selected} aria-controls={`${uid}-panel`}
              onClick={() => setMethod(g.methods.includes(method) ? method : g.methods[0])}
              className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                selected ? 'bg-neutral-900 text-white dark:bg-snow dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900')}>
              <Icon className="h-4 w-4" aria-hidden /> {CATEGORY_LABEL[g.category]}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active.category}`} className="mt-4">
        {active.methods.length > 1 && (
          <div role="radiogroup" aria-label={CATEGORY_LABEL[active.category]} className="mb-4 inline-flex rounded-lg bg-neutral-100 p-1 text-sm font-medium">
            {active.methods.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={method === m ? 'rounded-md bg-white px-3 py-1.5 text-neutral-900 shadow-sm dark:bg-neutral-800' : 'px-3 py-1.5 text-neutral-600 hover:text-neutral-900'}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        )}
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
