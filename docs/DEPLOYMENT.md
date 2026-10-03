# SokoGlobal — Production deployment (Vercel + Supabase + Flutterwave)

## 1. Supabase

1. Create the production project (pick the region closest to your Vercel function region).
2. In the SQL editor, run in order:
   `supabase/schema.sql` → `migrations/002_ops_payments_perf.sql` → `003_payouts_refunds_kyc_support.sql` → `004_tracking_and_vault.sql` → `005_admin_ops_reads.sql`.
   - 004 needs the **Vault** extension (enabled by default on Supabase; the migration also runs `create extension if not exists supabase_vault`).
   - 004 moves every existing payout account number into Vault and **drops the plaintext column**. Take a backup first (Database → Backups).
3. Auth → URL configuration: Site URL `https://<your-domain>`, redirect `https://<your-domain>/auth/callback`.
4. Promote your ops staff: `update public.profiles set role = 'admin' where id = '<uuid>';`
5. Database → Replication: confirm `support_messages` is in the `supabase_realtime` publication (004/003 add it).

## 2. Vercel project

- Framework preset: **Next.js**. Build command: `next build`. Node 20+.
- **Plan: Pro or above.** `vercel.json` schedules both cron jobs hourly; the Hobby plan only allows daily crons.
- Set the function region (Settings → Functions) to the one nearest your Supabase region.
- Crons in `vercel.json`:

  | Path | Schedule | Purpose |
  |---|---|---|
  | `/api/cron/expire-pools` | `5 * * * *` | Expire unfunded Trend Pools, refund paid pledges |
  | `/api/cron/reconcile-payouts` | `20 * * * *` | Resolve payouts with unknown outcome via `GET /v3/transfers?reference=` |
  | `/api/cron/retry-payouts` | `35 * * * *` | Retry held/failed payouts (incl. ones reconcile just failed), alert Slack |

  Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.

## 3. Environment variables

Set in Vercel → Settings → Environment Variables. **Production** values must never be shared with Preview: give Preview a separate Supabase project and Flutterwave **test** keys.

| Variable | Scope | Secret | Value / notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod, Preview | no | `https://<ref>.supabase.co`. Also whitelists the Storage host for `<Image />` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod, Preview | no | Supabase anon key (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod, Preview | **yes** | Server only; webhooks, cron, payouts |
| `NEXT_PUBLIC_SITE_URL` | Prod, Preview | no | `https://<your-domain>` (checkout redirects, transfer callbacks, Slack links) |
| `FLW_SECRET_KEY` | Prod, Preview | **yes** | `FLWSECK-…` live (Prod) / `FLWSECK_TEST-…` (Preview) |
| `FLW_SECRET_HASH` | Prod, Preview | **yes** | Same value as the webhook "secret hash" in the Flutterwave dashboard |
| `FLW_API_BASE_URL` | Prod, Preview | no | `https://api.flutterwave.com/v3` |
| `FLW_CHECKOUT_LOGO_URL` | Prod | no | Optional `https://…/logo.png` for hosted checkout |
| `FLW_OUTBOUND_PROXY_URL` | Prod | **yes** | Optional static-IP proxy (see §4) |
| `PLATFORM_FEE_BPS` | Prod, Preview | no | Commission on goods value in basis points, e.g. `500` = 5% |
| `CRON_SECRET` | Prod, Preview | **yes** | ≥ 32 random chars: `openssl rand -hex 32` |
| `SLACK_WEBHOOK_URL` | Prod (+ a test channel for Preview) | **yes** | `https://hooks.slack.com/services/…` (Slack app → Incoming Webhooks) |
| `NEXT_PUBLIC_MAP_TILE_URL` | Prod, Preview | no | Production tile provider URL (MapTiler/Stadia/Mapbox raster) |
| `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` | Prod, Preview | no | Attribution HTML required by your tile provider |
| `CSP_MODE` | Prod, Preview | no | `report-only` (default) → `enforce` after the soak period; `off` = kill-switch |
| `CSP_REPORT_URI` | Prod | no | Optional: Sentry "Security Header" endpoint; default `/api/csp-report` |

CLI equivalent (prompts for each value):

```bash
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL \
         FLW_SECRET_KEY FLW_SECRET_HASH FLW_API_BASE_URL PLATFORM_FEE_BPS CRON_SECRET SLACK_WEBHOOK_URL \
         NEXT_PUBLIC_MAP_TILE_URL NEXT_PUBLIC_MAP_TILE_ATTRIBUTION; do
  vercel env add "$v" production
done
```

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## 4. Flutterwave

- Webhook URL: `https://<your-domain>/api/webhooks/flutterwave`, with the secret hash = `FLW_SECRET_HASH`.
- Enable **Transfers**. Keep the **USD balance** funded; FX payouts debit USD (`debit_currency=USD`).
- **IP whitelisting:** Vercel functions have no fixed egress IP. If your Flutterwave account enforces
  IP whitelisting for transfers, either use Vercel Secure Compute (static IPs) or set
  `FLW_OUTBOUND_PROXY_URL` to a static-IP HTTPS proxy and whitelist the proxy's IPs. Confirm with
  your Flutterwave account manager before go-live.

## 5. Content-Security-Policy rollout

The CSP is emitted by `middleware.ts` (per-request nonce; policy in `lib/security/csp.ts`).

1. **Week 0:** deploy with `CSP_MODE=report-only`. Browsers report violations but nothing is blocked.
2. **Watch the reports.** By default they go to `/api/csp-report`, which logs one
   `[csp-violation] {…}` line per unique violation in Vercel Runtime Logs. Add a Log Drain (Datadog, Axiom,
   Better Stack) and alert on that prefix. Or set `CSP_REPORT_URI` to your Sentry project's Security
   Header endpoint (Sentry → Settings → Security Headers) to group them in Sentry.
3. Exercise every flow: sign-up/login, product upload (photos and swatch video), checkout redirect to
   Flutterwave, the order page map, support chat (Realtime websocket), the admin tracking form and KYC
   document viewing.
4. For each legitimate violation, add the source to `buildCsp()` and redeploy. Ignore
   browser-extension noise (the collector already drops most of it).
5. **After 1–2 clean weeks:** set `CSP_MODE=enforce` and redeploy. Keep reporting on. If anything
   breaks, set `CSP_MODE=report-only` (or `off`) and redeploy to roll back.

## 6. Go-live checklist

- [ ] All four SQL files applied; `select count(*) from supplier_payout_accounts where account_number_secret_id is null;` returns 0
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/retry-payouts` returns JSON (and 401 without the header)
- [ ] A test charge in Preview moves an order `pending_payment → funded`
- [ ] A test payout to a KES / NGN test account shows `payout_currency`, `fx_rate` and `fx_source_cents ≤ amount_cents` in `payouts`
- [ ] Slack channel receives a test alert (temporarily set a payout to `failed`, `attempts=5` in Preview)
- [ ] Map tiles load from the production provider; attribution visible
- [ ] Legal sign-off on FAQ policy text in `components/dashboard/SupportWidget.tsx`
- [ ] `curl -sI https://<domain>/login | grep -i content-security-policy` shows the Report-Only header with a nonce
- [ ] CSP reports are arriving (Vercel logs `[csp-violation]` or Sentry), then switch `CSP_MODE=enforce` after the soak period
