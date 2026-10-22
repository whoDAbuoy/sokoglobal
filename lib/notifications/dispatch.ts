import 'server-only';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderNotification, type Channel } from '@/lib/notifications/templates';
import { DeliveryError, sendEmail, sendSms } from '@/lib/notifications/providers';

type QueueRow = { id: string; channel: Channel; recipient: string; template_key: string; payload: Record<string, unknown>; attempts: number };

/** Channels with a configured provider; rows on other channels stay queued until one is set up. */
export function deliverableChannels(): Channel[] {
  const out: Channel[] = [];
  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL_FROM) out.push('email');
  if (process.env.AT_USERNAME && process.env.AT_API_KEY) out.push('sms');
  return out;
}

/**
 * Sends due rows from notification_queue (claim_notifications → provider →
 * finish_notification). Safe to run concurrently: claims are leased with SKIP LOCKED.
 */
export async function drainNotificationQueue({ limit = 50, budgetMs = 20_000 } = {}) {
  const channels = deliverableChannels();
  const result = { sent: 0, retrying: 0, failed: 0, channels };
  if (!channels.length) return result;

  const db = createAdminClient();
  const end = Date.now() + budgetMs;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokoglobal.com';
  let remaining = limit;

  while (remaining > 0 && Date.now() < end) {
    const { data, error } = await db.rpc('claim_notifications', { p_channels: channels, p_limit: Math.min(remaining, 25) });
    if (error) { console.error('[notify] claim failed', error.message); break; }
    const rows = (data ?? []) as QueueRow[];
    if (!rows.length) break;
    remaining -= rows.length;

    await Promise.all(rows.map(async (row) => {
      const msg = renderNotification(row.template_key, row.payload ?? {}, site);
      try {
        const { providerRef } = row.channel === 'email'
          ? await sendEmail(row.recipient, msg.subject, msg.text, msg.html)
          : await sendSms(row.recipient, msg.sms);
        await db.rpc('finish_notification', { p_id: row.id, p_success: true, p_provider_ref: providerRef });
        result.sent += 1;
      } catch (err) {
        const permanent = err instanceof DeliveryError && err.permanent;
        const message = err instanceof Error ? err.message : String(err);
        await db.rpc('finish_notification', { p_id: row.id, p_success: false, p_error: message, p_permanent: permanent });
        if (permanent || row.attempts >= 5) result.failed += 1; else result.retrying += 1;
        console.error('[notify] delivery failed', { id: row.id, channel: row.channel, template: row.template_key, attempt: row.attempts, message });
      }
    }));
  }
  return result;
}

/**
 * Sends whatever the current request just queued (order / KYC triggers) once the
 * response is out, so users hear about events in seconds rather than at the next cron.
 */
export function dispatchNotificationsAfterResponse() {
  try {
    after(async () => {
      try { await drainNotificationQueue({ limit: 20, budgetMs: 15_000 }); }
      catch (err) { console.error('[notify] background dispatch failed', err); }
    });
  } catch {
    // Outside a request (scripts, tests): the dispatch-notifications cron picks the rows up.
  }
}
