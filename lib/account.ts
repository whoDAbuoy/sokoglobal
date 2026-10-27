/**
 * Self-service account closure (migration 040) and data export (app/api/account/export), pure helpers.
 */

/** my_account_closure_blockers() → what the owner must finish first, in plain words (empty = can close). */
export function closureBlockers(raw: unknown): string[] {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (k: string) => (typeof b[k] === 'number' ? (b[k] as number) : 0);
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  if (n('signed_out')) return ['Sign in again.'];
  if (n('staff')) return ['Staff accounts are closed by a super admin, not from Settings.'];
  const out: string[] = [];
  if (n('open_orders')) out.push(`${plural(n('open_orders'), 'order')} you placed ${n('open_orders') === 1 ? 'is' : 'are'} still open. Wait for delivery and confirm it, or let unpaid orders expire.`);
  if (n('open_sales')) out.push(`${plural(n('open_sales'), 'paid order')} for your listings ${n('open_sales') === 1 ? 'is' : 'are'} not finished yet.`);
  if (n('pool_pledges')) out.push(`${plural(n('pool_pledges'), 'Trend Pool pledge')} ${n('pool_pledges') === 1 ? 'is' : 'are'} still active.`);
  if (n('payouts')) out.push(`${plural(n('payouts'), 'payout')} ${n('payouts') === 1 ? 'is' : 'are'} processing or on hold.`);
  if (n('transfers')) out.push(`${plural(n('transfers'), 'bank or crypto transfer')} ${n('transfers') === 1 ? 'is' : 'are'} awaiting review.`);
  return out;
}

export const CLOSE_CONFIRMATION = 'CLOSE';
export const isCloseConfirmation = (v: string) => v.trim().toUpperCase() === CLOSE_CONFIRMATION;

/** Address the auth user is moved to on closure, so the real email can sign up again later. */
export const closedEmail = (userId: string) => `closed+${userId}@closed.sokoglobal.invalid`;

/**
 * Everything the export collects, as [section, table, column holding the owner's id]. Reads run as the user, so
 * row-level security limits each one to what the account may see. Missing tables (older databases) are skipped.
 */
export const EXPORT_SOURCES: readonly (readonly [string, string, string])[] = [
  ['orders_placed', 'orders', 'buyer_id'],
  ['checkouts', 'checkout_groups', 'buyer_id'],
  ['card_payments', 'card_payments', 'buyer_id'],
  ['mpesa_payments', 'mpesa_payments', 'buyer_id'],
  ['bank_and_crypto_transfers', 'manual_payments', 'buyer_id'],
  ['trend_pool_pledges', 'pool_members', 'buyer_id'],
  ['rfqs', 'rfqs', 'buyer_id'],
  ['rfq_quotes', 'rfq_quotes', 'supplier_id'],
  ['listings', 'products', 'supplier_id'],
  ['shipments', 'shipments', 'supplier_id'],
  ['payouts', 'payouts', 'supplier_id'],
  ['subscriptions', 'subscriptions', 'user_id'],
  ['ratings_given', 'supplier_ratings', 'buyer_id'],
  ['following', 'follows', 'follower_id'],
  ['chat_threads_as_buyer', 'chat_threads', 'buyer_id'],
  ['chat_threads_as_supplier', 'chat_threads', 'supplier_id'],
  ['chat_messages_sent', 'chat_messages', 'sender_id'],
  ['support_tickets', 'support_tickets', 'user_id'],
  ['support_messages_sent', 'support_messages', 'sender_id'],
  ['notifications', 'user_notifications', 'user_id'],
  ['identity_verification', 'kyc_verifications', 'user_id'],
  ['supplier_verification', 'supplier_kyc', 'supplier_id'],
  ['verification_documents', 'kyc_documents', 'supplier_id'],
  ['profile_change_requests', 'profile_change_requests', 'user_id'],
] as const;

export const EXPORT_ROW_LIMIT = 5000;

/** Fields never written to an export file, whatever a table returns. */
const SECRET_KEYS = /secret|token|hash|backup_codes|account_number|totp/i;
export function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : v]));
}
