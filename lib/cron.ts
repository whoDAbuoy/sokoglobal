import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Any other scheduler
 * (GitHub Actions, cron-job.org, Supabase pg_cron + pg_net) must send the same.
 * Fails closed when CRON_SECRET is unset.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Stop starting new external calls once this much of the function budget is spent. */
export const deadline = (budgetMs: number) => {
  const end = Date.now() + budgetMs;
  return () => Date.now() < end;
};
