'use client';

/** Session returned by our card checkout routes (see lib/payments/checkout.ts). */
export interface CardSession {
  reference: string;
  accessCode: string;
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
}

/**
 * Open Paystack's secure card form (iframe overlay from checkout.paystack.com)
 * for a transaction our server initialized. Card number, expiry and CVC are
 * entered there and go straight to Paystack — never through SokoGlobal.
 * Resolves 'success' | 'cancelled'; if the overlay can't load, falls back to
 * Paystack's hosted page (full redirect) and never resolves.
 */
export async function openCardForm(session: CardSession): Promise<'success' | 'cancelled'> {
  try {
    const { default: PaystackPop } = await import('@paystack/inline-js');
    return await new Promise((resolve, reject) => {
      new PaystackPop().resumeTransaction(session.accessCode, {
        onSuccess: () => resolve('success'),
        onCancel: () => resolve('cancelled'),
        onError: (e: unknown) => reject(e),
      });
    });
  } catch {
    window.location.assign(session.authorizationUrl);
    return new Promise(() => {});
  }
}

/** Ask our server to verify the charge with Paystack right away (the webhook also does this). Best-effort. */
export async function confirmCardPayment(reference: string): Promise<string> {
  try {
    const res = await fetch('/api/payments/card/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference }),
    });
    return ((await res.json()) as { outcome?: string }).outcome ?? 'pending';
  } catch { return 'pending'; }
}
