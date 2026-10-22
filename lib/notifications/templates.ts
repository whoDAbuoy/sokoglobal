/**
 * Notification copy (pure). template_key + payload come from notification_queue,
 * written by the triggers in supabase/migrations/020_enterprise_upgrades.sql.
 */
export type Channel = 'email' | 'sms' | 'whatsapp';
export interface Rendered { subject: string; text: string; html: string; sms: string }

type Payload = Record<string, unknown>;
const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const shortId = (v: unknown) => str(v).slice(0, 8).toUpperCase();

export function formatMoney(cents: unknown, currency: unknown): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  const cur = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n / 100);
}

const DOC_LABEL: Record<string, string> = {
  national_id: 'national ID', passport: 'passport', business_license: 'business licence', tax_certificate: 'tax certificate',
};

interface Copy { subject: string; lines: string[]; sms: string; cta?: { label: string; path: string } }

function copyFor(key: string, p: Payload): Copy {
  const title = str(p.product_title, 'your order');
  const ref = shortId(p.order_id);
  const amount = formatMoney(p.total_cents, p.currency);
  const orderPath = `/dashboard/orders/${str(p.order_id)}`;
  const shipped = str(p.tracking_number) ? ` via ${str(p.carrier, 'courier')} (waybill ${str(p.tracking_number)})` : '';
  switch (key) {
    case 'order.funded':
      return { subject: `Payment received: ${title}`, lines: [`We received your payment of ${amount} for ${title}. It is held in escrow until you confirm delivery.`], sms: `SokoGlobal: payment of ${amount} received for order ${ref}. Funds are held in escrow.`, cta: { label: 'View order', path: orderPath } };
    case 'order.deposit_paid':
      return { subject: `Deposit received: ${title}`, lines: [`We received your 30% deposit of ${formatMoney(p.deposit_cents, p.currency)} for ${title}. It is held in escrow, and the supplier is preparing your order.`, `The remaining ${formatMoney(p.balance_cents, p.currency)} becomes payable once the order is dispatched.`], sms: `SokoGlobal: 30% deposit received for order ${ref}. Balance is due on dispatch.`, cta: { label: 'View order', path: orderPath } };
    case 'order.balance_due':
      return { subject: `Dispatched: pay the balance for ${title}`, lines: [`Your order ${ref} (${title}) has been dispatched${shipped}.`, `Pay the remaining ${amount} to keep it moving. It is held in escrow with your deposit until you verify the goods.`], sms: `SokoGlobal: order ${ref} dispatched${shipped}. Pay the ${amount} balance in your dashboard.`, cta: { label: 'Pay balance', path: orderPath } };
    case 'order.in_transit':
      return { subject: `On its way: ${title}`, lines: [`Your order ${ref} (${title}) has shipped${shipped}.`], sms: `SokoGlobal: order ${ref} has shipped${shipped}.`, cta: { label: 'Track shipment', path: orderPath } };
    case 'order.customs_cleared':
      return { subject: `Cleared customs: ${title}`, lines: [`Your order ${ref} cleared customs and is heading to you.`], sms: `SokoGlobal: order ${ref} cleared customs.`, cta: { label: 'Track shipment', path: orderPath } };
    case 'order.delivered_pending_verification':
      return { subject: `Delivered: please inspect ${title}`, lines: [`Your order ${ref} was delivered. Inspect the goods and confirm, or raise an issue, so we can release or hold the escrow.`], sms: `SokoGlobal: order ${ref} delivered. Inspect and confirm in your dashboard.`, cta: { label: 'Confirm delivery', path: orderPath } };
    case 'order.released':
      return { subject: `Order complete: ${title}`, lines: [`Thanks for confirming order ${ref}. The supplier has been paid.`], sms: `SokoGlobal: order ${ref} complete, supplier paid.` };
    case 'order.disputed':
      return { subject: `Issue raised: ${title}`, lines: [`We received your issue on order ${ref}. The escrow is frozen while our team reviews it.`], sms: `SokoGlobal: issue on order ${ref} received; escrow frozen.`, cta: { label: 'View order', path: orderPath } };
    case 'order.refunded':
      return { subject: `Refund issued: ${title}`, lines: [`We refunded ${amount} for order ${ref}. It can take a few business days to appear.`], sms: `SokoGlobal: ${amount} refunded for order ${ref}.` };
    case 'order.cancelled':
      return { subject: `Order cancelled: ${title}`, lines: [`Order ${ref} (${title}) was cancelled.`], sms: `SokoGlobal: order ${ref} cancelled.` };
    case 'order.expired':
      return { subject: `Order expired: ${title}`, lines: [`Order ${ref} (${title}) was not paid within 24 hours, so we cancelled it. You can place it again at any time.`], sms: `SokoGlobal: unpaid order ${ref} expired after 24h.`, cta: { label: 'Browse catalogue', path: '/dashboard/discover' } };
    case 'supplier.order_deposit':
      return { subject: `Deposit paid: ${title}`, lines: [`A buyer paid the 30% deposit on ${title} (order ${ref}); it is held in escrow. Please prepare it for dispatch.`, 'The buyer pays the remaining 70% into escrow once you dispatch. You are paid the full goods value when they confirm delivery.'], sms: `SokoGlobal: deposit paid on order ${ref} for ${title}. Prepare for dispatch.`, cta: { label: 'Open orders', path: '/supplier/orders' } };
    case 'supplier.order_balance_paid':
      return { subject: `Balance paid: ${title}`, lines: [`The buyer paid the balance on order ${ref} (${title}). The full order value is now held in escrow.`], sms: `SokoGlobal: balance paid on order ${ref}; full value in escrow.`, cta: { label: 'Open orders', path: '/supplier/orders' } };
    case 'supplier.rfq_accepted':
      return { subject: `Quote accepted: ${str(p.rfq_title, title)}`, lines: [`Your quote for "${str(p.rfq_title, title)}" was accepted as order ${ref} (${amount}).`, 'You will be notified when the buyer has paid into escrow, then you can dispatch it from your orders page.'], sms: `SokoGlobal: your quote was accepted as order ${ref} (${amount}).`, cta: { label: 'View requests', path: '/supplier/rfqs' } };
    case 'rfq.quote_received':
      return { subject: `New quote: ${str(p.rfq_title, 'your request')}`, lines: [`A supplier sent a quote for "${str(p.rfq_title, 'your request')}". Compare quotes and accept the one that suits you.`], sms: `SokoGlobal: new quote for "${str(p.rfq_title, 'your request')}".`, cta: { label: 'Compare quotes', path: '/dashboard/rfqs' } };
    case 'retention.restock_reminder': {
      const days = typeof p.days === 'number' ? p.days : 30;
      return { subject: `Time to restock ${title}?`, lines: [`It has been ${days} days since your order of ${title} was completed.`, 'You can reorder the same batch in one click from your orders page — prices are confirmed at checkout.'], sms: `SokoGlobal: ${days} days since your ${title} order. Reorder in one click from My Orders.`, cta: { label: 'Reorder', path: '/dashboard/orders#reorder' } };
    }
    case 'supplier.order_funded':
      return { subject: `New paid order: ${title}`, lines: [`A buyer paid ${amount} for ${title} (order ${ref}). Funds are in escrow; please prepare it for dispatch.`], sms: `SokoGlobal: new paid order ${ref} for ${title}. Prepare for dispatch.`, cta: { label: 'Open orders', path: '/supplier/orders' } };
    case 'kyc.approved':
      return { subject: 'Your business is verified', lines: ['Your verification documents were approved. You can now place escrow orders and use every SokoGlobal feature.'], sms: 'SokoGlobal: your business verification is approved.', cta: { label: 'Go to dashboard', path: p.role === 'supplier' ? '/supplier' : '/dashboard' } };
    case 'kyc.rejected':
      return { subject: 'Verification needs your attention', lines: ['We could not verify your account with the documents provided. Open your verification page to see what to fix.'], sms: 'SokoGlobal: your verification needs attention. Check your dashboard.', cta: { label: 'Fix verification', path: p.role === 'supplier' ? '/supplier/verification' : '/dashboard/kyc' } };
    case 'kyc.document_rejected': {
      const doc = DOC_LABEL[str(p.document_type)] ?? 'document';
      const reason = str(p.reason);
      return { subject: `Your ${doc} was not accepted`, lines: [`Your ${doc} was not accepted.`, ...(reason ? [`Reviewer's note: ${reason}`] : []), 'Upload a replacement to continue.'], sms: `SokoGlobal: your ${doc} was not accepted. See the note in your dashboard.`, cta: { label: 'Upload replacement', path: '/dashboard/kyc' } };
    }
    default:
      return { subject: 'Update from SokoGlobal', lines: ['There is an update on your SokoGlobal account.'], sms: 'SokoGlobal: there is an update on your account.' };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** SMS stays within two GSM segments (≤ 306 chars). */
export const SMS_MAX = 306;

export function renderNotification(key: string, payload: Payload, siteUrl: string): Rendered {
  const c = copyFor(key, payload);
  const base = siteUrl.replace(/\/+$/, '');
  const link = c.cta ? `${base}${c.cta.path}` : null;
  const text = [...c.lines, ...(link ? ['', `${c.cta!.label}: ${link}`] : []), '', '— SokoGlobal'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e5e7eb">
<p style="margin:0 0 16px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:600">SokoGlobal</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(c.subject)}</h1>
${c.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(l)}</p>`).join('\n')}
${link ? `<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px">${escapeHtml(c.cta!.label)}</a></p>` : ''}
</div><p style="margin:16px 0 0;font-size:12px;color:#6b7280;text-align:center">You can change these emails in Settings → Notifications.</p></div></body></html>`;
  const sms = c.sms.length > SMS_MAX ? `${c.sms.slice(0, SMS_MAX - 1)}…` : c.sms;
  return { subject: c.subject, text, html, sms };
}
