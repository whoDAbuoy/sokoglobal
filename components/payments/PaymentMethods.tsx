'use client';

import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Bitcoin, Check, CreditCard, Landmark, Lock, Smartphone, Wallet, X, type LucideIcon } from 'lucide-react';
import {
  CATEGORY_LABEL, METHOD_CATEGORY, METHOD_LABEL, WIRE_SUGGESTED_CENTS, methodOptions,
  type CryptoOption, type ManualPaymentView, type PaymentMethod, type SwiftDetails,
} from '@/lib/payment-methods';
import BankCardPanel from './BankCardPanel';
import GatewayRedirect from './GatewayRedirect';
import AirtelPay from './AirtelPay';
import { CryptoPanel, WireTransferPanel } from './ManualPayment';
import MpesaPay from '@/app/dashboard/orders/[id]/MpesaPay';

/** One tile per method in the "Pay now" picker. */
const METHOD_TILE: Record<PaymentMethod, { icon: LucideIcon; hint: string }> = {
  mpesa: { icon: Smartphone, hint: 'STK push to your Safaricom phone' },
  airtel_money: { icon: Smartphone, hint: 'Mobile money prompt to your Airtel line' },
  card: { icon: CreditCard, hint: 'Visa / Mastercard on a secure card form' },
  dpo_pay: { icon: CreditCard, hint: 'Cards and pan-African wallets via DPO Pay' },
  paypal: { icon: Wallet, hint: 'Your PayPal balance or a linked card' },
  swift_wire: { icon: Landmark, hint: 'Bank transfer straight to the escrow account' },
  crypto: { icon: Bitcoin, hint: 'USDT / USDC stablecoins into escrow' },
};

export interface ManualContext {
  buyerId: string; dueCents: number; open: ManualPaymentView | null; rejectedNote: string | null;
  swift: SwiftDetails; cryptoOptions: CryptoOption[]; cryptoMarkup: number;
}

/**
 * Checkout payment picker (migration 028). Orders are placed without choosing a channel; here "Pay now" opens a
 * frosted-glass list of every supported method, each as its own option (M-Pesa, Airtel Money, card, DPO Pay,
 * PayPal, SWIFT wire, crypto). Methods the server offers for this payment are selectable; the rest stay listed
 * but disabled with a reason (e.g. wire and crypto on a cart: single orders only). Picking one shows that
 * method's own handler below, with "Change" to pick again. Every method charges what Postgres says is due; nothing here
 * sets an amount.
 */
export default function PaymentMethods({ target, methods, preferred, amountLabel, buyerName, manual }: {
  target: { kind: 'order' | 'group'; id: string };
  methods: PaymentMethod[];
  /** ?pay=… or the method of an open wire / crypto transfer: opens straight on that method. */
  preferred?: string | null;
  amountLabel: string;
  buyerName?: string;
  /** Wire / crypto context (single orders only). */
  manual?: ManualContext;
}) {
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Wire and crypto need the per-order context; without it they cannot be offered.
  const offered = methods.filter((m) => (m === 'swift_wire' || m === 'crypto') ? !!manual : true);
  const openMethod: PaymentMethod | null = manual?.open ? (manual.open.method === 'swift_wire' ? 'swift_wire' : 'crypto') : null;
  const initial = openMethod ?? (preferred && (offered as string[]).includes(preferred) ? preferred as PaymentMethod : null);
  const [method, setMethod] = useState<PaymentMethod | null>(initial);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (picking && !d.open) d.showModal();
    if (!picking && d.open) d.close();
  }, [picking]);

  if (!offered.length) {
    return <p className="text-sm text-neutral-600">Online payment isn&apos;t available right now. Please try again shortly or contact support.</p>;
  }
  const options = methodOptions(offered, target.kind === 'order');
  const choose = (m: PaymentMethod) => { setMethod(m); setPicking(false); };
  const base = target.kind === 'order' ? `/api/orders/${target.id}` : `/api/checkout/${target.id}`;
  const returnPath = target.kind === 'order' ? `/dashboard/orders/${target.id}` : `/dashboard/checkout/${target.id}`;

  return (
    <div>
      {method ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-neutral-700">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#5a9895]/20 text-[#8fd3cc]">{(() => { const I = METHOD_TILE[method].icon; return <I className="h-4 w-4" aria-hidden />; })()}</span>
            Paying with <span className="font-medium text-neutral-900">{METHOD_LABEL[method]}</span>
          </p>
          {!openMethod && (
            <button type="button" onClick={() => setPicking(true)} className="sx-link px-2 py-1 underline-offset-4 hover:underline">Change method</button>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-controls={`${uid}-picker`}
          className="btn-primary w-full py-3 text-base transition-all active:scale-95">
          <Lock className="h-4 w-4" aria-hidden /> Pay now · {amountLabel} <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* Method picker: native modal dialog (focus trap, Esc closes); the backdrop click closes too. */}
      <dialog ref={dialogRef} id={`${uid}-picker`} aria-labelledby={`${uid}-picker-title`} onClose={() => setPicking(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setPicking(false); }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] bg-transparent p-0 text-neutral-900 backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <div className="sx-glass dark sellsy p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={`${uid}-picker-title`} className="text-lg font-semibold">Choose how to pay</h2>
              <p className="mt-0.5 text-sm text-neutral-500">{amountLabel} goes into escrow, not to the supplier.</p>
            </div>
            <button type="button" onClick={() => setPicking(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-neutral-500 hover:bg-snow/10 hover:text-neutral-900">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <ul className="mt-5 grid gap-2" aria-label="Payment methods">
            {options.map(({ method: m, enabled, blocked, reason }) => {
              const { icon: Icon, hint } = METHOD_TILE[m];
              const selected = m === method;
              return (
                <li key={m}>
                  {/* Unavailable methods stay listed (disabled, with the reason) so buyers see every channel. */}
                  <button type="button" onClick={() => choose(m)} aria-pressed={enabled ? selected : undefined} disabled={!enabled}
                    aria-describedby={reason ? `${uid}-why-${m}` : undefined}
                    className={clsx('flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5a9895]',
                      !enabled ? 'cursor-not-allowed border-snow/[0.06] bg-transparent'
                        : selected ? 'press border-[#5a9895] bg-[#5a9895]/15' : 'press border-snow/10 bg-snow/[0.03] hover:border-snow/25 hover:bg-snow/[0.06]')}>
                    <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full', enabled ? 'bg-[#5a9895]/20 text-[#8fd3cc]' : 'bg-snow/[0.05] text-neutral-500')}>
                      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-sm font-medium', enabled ? 'text-neutral-900' : 'text-neutral-600')}>{METHOD_LABEL[m]}</span>
                      {reason
                        ? <span id={`${uid}-why-${m}`} className="block text-xs text-neutral-500">{reason}</span>
                        : <span className="block truncate text-xs text-neutral-500">{hint} · {CATEGORY_LABEL[METHOD_CATEGORY[m]]}</span>}
                    </span>
                    {!enabled
                      ? <span className="sx-pill sx-pill-muted shrink-0">{blocked === 'single_order' ? 'Single orders' : 'Unavailable'}</span>
                      : selected ? <Check className="h-4 w-4 text-[#8fd3cc]" aria-hidden /> : <ArrowRight className="h-4 w-4 text-neutral-400" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </dialog>

      {method && (
      <div className="glass-inset mt-4 p-4 sm:p-5">
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
      )}
    </div>
  );
}
