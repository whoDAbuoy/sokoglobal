import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { availableMethods, parsePaymentSettings, type PaymentMethod, type PaymentSettings } from '@/lib/payment-methods';
import { isDpoConfigured } from '@/lib/payments/dpo';
import { isPaystackConfigured } from '@/lib/payments/paystack';
import { isPaypalConfigured } from '@/lib/payments/paypal';
import { airtelConfig, isAirtelConfigured } from '@/lib/payments/airtel';
import { exceedsMpesaLimit } from '@/lib/payments/mpesa';

const COLUMNS_028 = 'enable_dpo_pay, enable_airtel_money, enable_paypal, enable_swift_wire, enable_crypto, swift_bank_details, crypto_deposit_wallets, crypto_markup_percent, fx_spread_percent, payments_updated_at';

const COLUMNS_039 = `enable_card, enable_mpesa, ${COLUMNS_028}`;

/**
 * Payment switches, bank details and wallets (migration 028; card and M-Pesa switches from 039).
 * Before 028: only card and M-Pesa. `cardSwitches` says whether 039's switches exist yet.
 */
export async function getPaymentSettings(supabase: SupabaseClient): Promise<{ available: boolean; cardSwitches: boolean; settings: PaymentSettings; fxSpread: number; updatedAt: string | null }> {
  let cardSwitches = true;
  let { data, error } = await supabase.from('platform_settings').select(COLUMNS_039).maybeSingle();
  if (error && /column|does not exist/i.test(error.message)) {
    cardSwitches = false;
    ({ data, error } = await supabase.from('platform_settings').select(COLUMNS_028).maybeSingle());
  }
  if (error || !data) return { available: false, cardSwitches: false, settings: parsePaymentSettings(null), fxSpread: 0, updatedAt: null };
  const row = data as unknown as Record<string, unknown>;
  return { available: true, cardSwitches, settings: parsePaymentSettings(row), fxSpread: Number(row.fx_spread_percent) || 0, updatedAt: (row.payments_updated_at as string | null) ?? null };
}

/** Which gateways have their API keys set on this deployment. */
export function gatewaysConfigured() {
  return {
    card: isPaystackConfigured(), mpesa: process.env.NEXT_PUBLIC_MPESA_ENABLED === 'true',
    airtel_money: isAirtelConfigured(), dpo_pay: isDpoConfigured(), paypal: isPaypalConfigured(),
  };
}

/** Airtel Money charges whole local units at the configured rate plus the FX spread (begin_gateway_payment). */
export function exceedsAirtelLimit(usdCents: number, fxSpread: number): boolean {
  try {
    const cfg = airtelConfig();
    return Math.ceil(Math.ceil(usdCents * cfg.usdRate * (1 + fxSpread) - 1e-9) / 100) > cfg.maxAmount;
  } catch { return false; }
}

/** Methods a buyer may use for this amount (switches + configuration + limits). */
export function methodsFor(input: { settings: PaymentSettings; fxSpread: number; dueCents: number; cart: boolean }): PaymentMethod[] {
  const configured = gatewaysConfigured();
  return availableMethods({
    settings: input.settings, configured, cart: input.cart,
    mpesaOverLimit: input.dueCents > 0 && exceedsMpesaLimit(input.dueCents, input.fxSpread),
    airtelOverLimit: input.dueCents > 0 && exceedsAirtelLimit(input.dueCents, input.fxSpread),
  });
}
