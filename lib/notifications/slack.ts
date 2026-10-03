import 'server-only';

/**
 * Slack Incoming Webhook client for ops alerts.
 *
 * - Never throws: alerting must not break the job that calls it. Returns
 *   { ok:false } so callers can avoid marking alerts as delivered.
 * - Only posts to hooks.slack.com (guards against a mis-set env var turning
 *   this into a request to an arbitrary host).
 * - Messages carry references and amounts only — never account numbers,
 *   names, emails or other PII.
 */
const SLACK_HOST = 'hooks.slack.com';
const MAX_ITEMS_PER_GROUP = 15;   // keeps us well under Slack's 50-block / 3,000-char limits

export interface OpsAlertItem {
  key: string;
  kind: string;
  reference: string;
  detail: string | null;
  amount_cents: number | null;
  currency: string | null;
  first_seen_at: string;
}

const KIND_META: Record<string, { title: string; emoji: string; action: string }> = {
  payout_missing_transfer_id: { title: 'Payout outcome unknown (no transfer id)', emoji: ':warning:', action: 'Look up the reference in Flutterwave → Transfers before any retry.' },
  payout_no_webhook:          { title: 'Payout sent, no completion webhook (48h)', emoji: ':hourglass:', action: 'Check transfer status in Flutterwave; replay the webhook if completed.' },
  payout_failed_final:        { title: 'Payout failed 5×', emoji: ':x:', action: 'Fix the beneficiary details or pay manually, then close.' },
  payout_on_hold_long:        { title: 'Payout on hold > 72h', emoji: ':pause_button:', action: 'Usually pending KYC or account re-verification.' },
  refund_failed_final:        { title: 'Pool refund failed 5×', emoji: ':x:', action: 'Refund manually in Flutterwave; buyer is waiting.' },
  refund_stuck:               { title: 'Pool refund stuck in processing', emoji: ':warning:', action: 'Check whether Flutterwave issued the refund before re-queuing.' },
  payment_mismatch:           { title: 'Payment needs manual matching', emoji: ':mag:', action: 'Amount/currency/reference mismatch — refund or match by hand.' },
};

/** Slack mrkdwn escaping: only &, <, > are control characters. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const money = (cents: number | null, currency: string | null) =>
  cents == null ? '' : ` · ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ''}`.trimEnd();

export async function postSlack(payload: { text: string; blocks?: unknown[] }): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'SLACK_WEBHOOK_URL not configured' };
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'SLACK_WEBHOOK_URL is not a URL' }; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== SLACK_HOST) return { ok: false, error: 'SLACK_WEBHOOK_URL must be https://hooks.slack.com/…' };

  try {
    const res = await fetch(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ok: false, error: `Slack responded ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build and send one grouped "needs manual review" message. */
export async function sendOpsAlert(items: OpsAlertItem[], context: { environment: string; dashboardUrl?: string }) {
  if (items.length === 0) return { ok: true as const, sent: 0 };

  const groups = new Map<string, OpsAlertItem[]>();
  for (const it of items) groups.set(it.kind, [...(groups.get(it.kind) ?? []), it]);

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: `SokoGlobal · ${items.length} item(s) need manual review`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `*${esc(context.environment)}* · ${new Date().toISOString()}` }] },
  ];

  for (const [kind, list] of groups) {
    const meta = KIND_META[kind] ?? { title: kind, emoji: ':grey_question:', action: '' };
    const lines = list.slice(0, MAX_ITEMS_PER_GROUP).map((it) =>
      `• \`${esc(it.reference)}\`${esc(money(it.amount_cents, it.currency))}${it.detail ? ` — ${esc(it.detail).slice(0, 160)}` : ''}`);
    if (list.length > MAX_ITEMS_PER_GROUP) lines.push(`_…and ${list.length - MAX_ITEMS_PER_GROUP} more_`);
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${meta.emoji} *${esc(meta.title)}* (${list.length})\n${lines.join('\n')}`.slice(0, 2900) } });
    if (meta.action) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: esc(meta.action) }] });
  }

  if (context.dashboardUrl) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open ops dashboard' }, url: context.dashboardUrl }] });
  }

  const result = await postSlack({ text: `SokoGlobal: ${items.length} payment item(s) need manual review`, blocks: blocks.slice(0, 50) });
  return { ...result, sent: result.ok ? items.length : 0 };
}
