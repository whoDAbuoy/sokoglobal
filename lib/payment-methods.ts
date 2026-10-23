/**
 * Payment methods (pure): which ones a buyer sees, grouped for the checkout tabs,
 * plus the wire / crypto rules shared with migration 028 (begin_manual_payment,
 * submit_manual_payment, super_set_payment_settings). Postgres re-checks all of it.
 */
export type PaymentMethod = 'mpesa' | 'airtel_money' | 'card' | 'dpo_pay' | 'paypal' | 'swift_wire' | 'crypto';
export type PaymentCategory = 'mobile' | 'cards' | 'global' | 'wire' | 'crypto';

export const CATEGORY_LABEL: Record<PaymentCategory, string> = {
  mobile: 'Local Mobile Money', cards: 'Cards & Pan-African', global: 'Global Digital Payments', wire: 'B2B Bank Wire', crypto: 'Crypto Escrow',
};
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  mpesa: 'M-Pesa', airtel_money: 'Airtel Money', card: 'Credit / Debit Card', dpo_pay: 'DPO Pay', paypal: 'PayPal',
  swift_wire: 'SWIFT Wire Transfer', crypto: 'USDT / USDC',
};
export const METHOD_CATEGORY: Record<PaymentMethod, PaymentCategory> = {
  mpesa: 'mobile', airtel_money: 'mobile', card: 'cards', dpo_pay: 'cards', paypal: 'global', swift_wire: 'wire', crypto: 'crypto',
};
const ORDER: PaymentMethod[] = ['mpesa', 'airtel_money', 'card', 'dpo_pay', 'paypal', 'swift_wire', 'crypto'];

/** Orders at or above this go best by wire (still offered below it). */
export const WIRE_SUGGESTED_CENTS = 500_000;

export interface PaymentSwitches {
  enable_dpo_pay: boolean; enable_airtel_money: boolean; enable_paypal: boolean; enable_swift_wire: boolean; enable_crypto: boolean;
}
export const DEFAULT_SWITCHES: PaymentSwitches = { enable_dpo_pay: true, enable_airtel_money: true, enable_paypal: true, enable_swift_wire: true, enable_crypto: false };

export interface SwiftDetails { bank_name: string; swift_code: string; account_number: string; account_name: string; routing_number: string; bank_address?: string }
export const SWIFT_FIELDS = ['bank_name', 'swift_code', 'account_number', 'account_name', 'routing_number', 'bank_address'] as const;
export type CryptoWalletKey = 'usdt_trc20' | 'usdt_erc20' | 'usdc_polygon';
export type CryptoWallets = Record<CryptoWalletKey, string>;
export const WALLET_KEYS: CryptoWalletKey[] = ['usdt_trc20', 'usdt_erc20', 'usdc_polygon'];

export interface PaymentSettings extends PaymentSwitches {
  swift_bank_details: SwiftDetails; crypto_deposit_wallets: CryptoWallets; crypto_markup_percent: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** platform_settings row → settings; missing pieces (before migration 028) fall back to "off / empty". */
export function parsePaymentSettings(raw: unknown): PaymentSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const flag = (k: keyof PaymentSwitches) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : false);
  const b = (r.swift_bank_details && typeof r.swift_bank_details === 'object' ? r.swift_bank_details : {}) as Record<string, unknown>;
  const w = (r.crypto_deposit_wallets && typeof r.crypto_deposit_wallets === 'object' ? r.crypto_deposit_wallets : {}) as Record<string, unknown>;
  const markup = Number(r.crypto_markup_percent);
  return {
    enable_dpo_pay: flag('enable_dpo_pay'), enable_airtel_money: flag('enable_airtel_money'), enable_paypal: flag('enable_paypal'),
    enable_swift_wire: flag('enable_swift_wire'), enable_crypto: flag('enable_crypto'),
    swift_bank_details: { bank_name: str(b.bank_name), swift_code: str(b.swift_code), account_number: str(b.account_number),
      account_name: str(b.account_name), routing_number: str(b.routing_number), bank_address: str(b.bank_address) },
    crypto_deposit_wallets: { usdt_trc20: str(w.usdt_trc20), usdt_erc20: str(w.usdt_erc20), usdc_polygon: str(w.usdc_polygon) },
    crypto_markup_percent: Number.isFinite(markup) && markup >= 0 && markup <= 0.05 ? markup : 0.01,
  };
}

/** Mirrors swift_details_complete(). */
export const swiftComplete = (b: SwiftDetails) => !!(b.bank_name && b.swift_code && b.account_number && b.account_name);

// ── Crypto ──────────────────────────────────────────────────────────────────

export type CryptoNetwork = 'trc20' | 'erc20' | 'polygon';
export interface CryptoOption { method: 'crypto_usdt' | 'crypto_usdc'; network: CryptoNetwork; wallet: CryptoWalletKey; label: string }
export const CRYPTO_OPTIONS: CryptoOption[] = [
  { method: 'crypto_usdt', network: 'trc20', wallet: 'usdt_trc20', label: 'USDT · TRON (TRC-20)' },
  { method: 'crypto_usdt', network: 'erc20', wallet: 'usdt_erc20', label: 'USDT · Ethereum (ERC-20)' },
  { method: 'crypto_usdc', network: 'polygon', wallet: 'usdc_polygon', label: 'USDC · Polygon' },
];
export const NETWORK_LABEL: Record<CryptoNetwork, string> = { trc20: 'TRON (TRC-20)', erc20: 'Ethereum (ERC-20)', polygon: 'Polygon' };

/** Options whose deposit wallet is set. */
export const cryptoOptions = (w: CryptoWallets) => CRYPTO_OPTIONS.filter((o) => !!w[o.wallet]);

/** Mirrors begin_manual_payment(): handling fee rounded up to the cent. */
export const cryptoFeeCents = (dueCents: number, markup: number) => (dueCents > 0 && markup > 0 ? Math.ceil(dueCents * markup - 1e-9) : 0);

/** Same formats as super_set_payment_settings(). */
export function validWallet(key: CryptoWalletKey, address: string): boolean {
  const a = address.trim();
  if (!a) return true;
  return key === 'usdt_trc20' ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** Same rules as submit_manual_payment(); returns the stored form (lower case; TRON without 0x) or null. */
export function normalizeTxHash(network: CryptoNetwork, input: string): string | null {
  const h = input.trim();
  if (network === 'trc20') return /^(0x)?[0-9a-fA-F]{64}$/.test(h) ? h.replace(/^0x/, '').toLowerCase() : null;
  return /^0x[0-9a-fA-F]{64}$/.test(h) ? h.toLowerCase() : null;
}

export function explorerUrl(network: CryptoNetwork, txHash: string): string {
  const h = encodeURIComponent(txHash);
  return network === 'trc20' ? `https://tronscan.org/#/transaction/${h}`
    : network === 'erc20' ? `https://etherscan.io/tx/${h}` : `https://polygonscan.com/tx/${h}`;
}

/** Bank details form: same checks as super_set_payment_settings(). */
export function swiftFieldError(field: (typeof SWIFT_FIELDS)[number], value: string): string | null {
  const v = field === 'swift_code' ? value.trim().toUpperCase() : value.trim();
  if (v.length > (field === 'bank_address' ? 300 : 120)) return 'Too long.';
  if (!v) return null;
  if (field === 'swift_code' && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v)) return 'SWIFT/BIC is 8 or 11 letters and digits.';
  if (field === 'account_number' && !/^[A-Za-z0-9 -]{4,40}$/.test(v)) return '4–40 letters, digits, spaces or dashes.';
  if (field === 'routing_number' && !/^[A-Za-z0-9 -]{3,20}$/.test(v)) return '3–20 letters or digits.';
  return null;
}

// ── Availability ────────────────────────────────────────────────────────────

export interface AvailabilityInput {
  settings: PaymentSettings;
  /** Server-side configuration (API keys present) per gateway. */
  configured: { card: boolean; mpesa: boolean; airtel_money: boolean; dpo_pay: boolean; paypal: boolean };
  /** Cart checkouts pay online only (wire and crypto are per order). */
  cart: boolean;
  /** Amount due exceeds the M-Pesa per-payment limit. */
  mpesaOverLimit?: boolean;
  /** Amount due exceeds the Airtel Money per-payment limit. */
  airtelOverLimit?: boolean;
}

/** Methods to offer, in display order. A method shows only when switched on AND configured. */
export function availableMethods(i: AvailabilityInput): PaymentMethod[] {
  const s = i.settings;
  const on: Record<PaymentMethod, boolean> = {
    mpesa: i.configured.mpesa && !i.mpesaOverLimit,
    airtel_money: s.enable_airtel_money && i.configured.airtel_money && !i.airtelOverLimit,
    card: i.configured.card,
    dpo_pay: s.enable_dpo_pay && i.configured.dpo_pay,
    paypal: s.enable_paypal && i.configured.paypal,
    swift_wire: !i.cart && s.enable_swift_wire && swiftComplete(s.swift_bank_details),
    crypto: !i.cart && s.enable_crypto && cryptoOptions(s.crypto_deposit_wallets).length > 0,
  };
  return ORDER.filter((m) => on[m]);
}

/** Tabs (categories) with their methods, keeping only non-empty ones. */
export function groupByCategory(methods: readonly PaymentMethod[]): { category: PaymentCategory; methods: PaymentMethod[] }[] {
  const cats: PaymentCategory[] = ['mobile', 'cards', 'global', 'wire', 'crypto'];
  return cats.map((category) => ({ category, methods: methods.filter((m) => METHOD_CATEGORY[m] === category) })).filter((g) => g.methods.length > 0);
}

/** Which method to open first: what the buyer asked for, then M-Pesa, then card, then the first available. */
export function defaultMethod(methods: readonly PaymentMethod[], preferred?: string | null): PaymentMethod | null {
  if (preferred && (methods as string[]).includes(preferred)) return preferred as PaymentMethod;
  return methods.includes('mpesa') ? 'mpesa' : methods.includes('card') ? 'card' : methods[0] ?? null;
}

// ── Manual payment records ──────────────────────────────────────────────────

export type ManualStatus = 'awaiting' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
export interface ManualPaymentView {
  id: string; method: 'swift_wire' | 'crypto_usdt' | 'crypto_usdc'; network: CryptoNetwork | null; leg: string | null;
  usd_cents: number; fee_cents: number; charge_cents: number; reference: string; pay_to: Record<string, string>;
  tx_hash: string | null; proof_path: string | null; status: ManualStatus; review_note: string | null; created_at: string; submitted_at: string | null;
}

export const MANUAL_METHOD_LABEL: Record<ManualPaymentView['method'], string> = { swift_wire: 'SWIFT wire', crypto_usdt: 'USDT', crypto_usdc: 'USDC' };

/** Payment-proof upload path, as submit_manual_payment() expects it. */
export const proofPath = (buyerId: string, paymentId: string, fileId: string, ext: 'pdf' | 'jpg' | 'png') => `${buyerId}/${paymentId}/${fileId}.${ext}`;
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export function proofExt(type: string): 'pdf' | 'jpg' | 'png' | null {
  return type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : null;
}
