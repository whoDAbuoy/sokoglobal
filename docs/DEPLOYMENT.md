# SokoGlobal — Production deployment (Vercel + Supabase + Flutterwave)

## 1. Supabase

1. Create the production project (pick the region closest to your Vercel function region).
2. In the SQL editor, run in order:
   `supabase/schema.sql` → `migrations/002_ops_payments_perf.sql` → `003_payouts_refunds_kyc_support.sql` → `004_tracking_and_vault.sql` → `005_admin_ops_reads.sql` → `006_admin_moderation.sql` → `007_mpesa_payments.sql` → `008_cart_checkout.sql` → `009_realtime_chat.sql` → `010_cart_quantities.sql` → `011_paystack_cards.sql`, then every later file in `supabase/migrations/` in number order (through `021_enterprise_features.sql`).
   - Apply each migration **before** deploying the code that needs it (021: RFQs, shipments, milestone escrow, exchange rates). `npm run test:db` (Docker) replays the whole chain on a throwaway Postgres first.
   - After 021, set real rates in **Control room → Display exchange rates** (the seeded ones are placeholders).
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
| `TWO_FACTOR_ENCRYPTION_KEY` | Prod, Preview | **yes** | `openssl rand -base64 32`. Encrypts TOTP secrets (migration 016). Different per environment; rotating it disables every enrolled device |
| `NEXT_PUBLIC_SITE_URL` | Prod, Preview | no | `https://<your-domain>` (checkout redirects, transfer callbacks, Slack links) |
| `PAYSTACK_SECRET_KEY` | Prod, Preview | **yes** | `sk_live_…` (Prod) / `sk_test_…` (Preview). Also verifies webhook signatures |
| `PAYSTACK_CURRENCY` | Prod, Preview | no | Settlement currency of the Paystack account (default `USD`) |
| `PAYSTACK_USD_RATE` | Prod, Preview | no | Required if `PAYSTACK_CURRENCY` isn't USD (units per USD) |
| `FLW_SECRET_KEY` | Prod, Preview | **yes** | `FLWSECK-…` live (Prod) / `FLWSECK_TEST-…` (Preview) — payouts only |
| `FLW_SECRET_HASH` | Prod, Preview | **yes** | Same value as the webhook "secret hash" in the Flutterwave dashboard |
| `FLW_API_BASE_URL` | Prod, Preview | no | `https://api.flutterwave.com/v3` |
| `FLW_OUTBOUND_PROXY_URL` | Prod | **yes** | Optional static-IP proxy (see §4) |
| `PLATFORM_FEE_BPS` | Prod, Preview | no | Commission for orders placed before migration 026, in basis points (`500` = 5%). Newer orders use the rates in `/admin/financials` |
| `CRON_SECRET` | Prod, Preview | **yes** | ≥ 32 random chars: `openssl rand -hex 32` |
| `SLACK_WEBHOOK_URL` | Prod (+ a test channel for Preview) | **yes** | `https://hooks.slack.com/services/…` (Slack app → Incoming Webhooks) |
| `NEXT_PUBLIC_MAP_TILE_URL` | Prod, Preview | no | Production tile provider URL (MapTiler/Stadia/Mapbox raster) |
| `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` | Prod, Preview | no | Attribution HTML required by your tile provider |
| `CSP_MODE` | Prod, Preview | no | `report-only` (default) → `enforce` after the soak period; `off` = kill-switch |
| `CSP_REPORT_URI` | Prod | no | Optional: Sentry "Security Header" endpoint; default `/api/csp-report` |

CLI equivalent (prompts for each value):

```bash
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SITE_URL \
         PAYSTACK_SECRET_KEY PAYSTACK_CURRENCY FLW_SECRET_KEY FLW_SECRET_HASH FLW_API_BASE_URL PLATFORM_FEE_BPS CRON_SECRET SLACK_WEBHOOK_URL \
         NEXT_PUBLIC_MAP_TILE_URL NEXT_PUBLIC_MAP_TILE_ATTRIBUTION; do
  vercel env add "$v" production
done
```

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## 4. Bank Cards — Paystack

Buyers pay by **Bank Card (Visa / Mastercard)** through Paystack (migration `011_paystack_cards.sql`).
Card number, expiry and CVC are entered in Paystack's secure form (iframe from `checkout.paystack.com`),
so card data never touches SokoGlobal's servers.

- Webhook URL: `https://<your-domain>/api/webhooks/card` or the alias `/api/webhooks/paystack` (Paystack → Settings → API Keys & Webhooks).
  Use the exact host Vercel serves (no redirect): webhook senders do not follow redirects, so `https://sokoglobal.shop/...`
  fails while the apex domain redirects to `www`.
  Events are authenticated with `x-paystack-signature` (HMAC-SHA512 of the body with `PAYSTACK_SECRET_KEY`).
- Every charge is re-verified with `GET /transaction/verify/:reference` before escrow is funded; the
  buyer's browser also asks for that verification right after paying, so confirmation doesn't wait for the webhook.
- `PAYSTACK_CURRENCY` must match what your Paystack account can charge. With a non-USD account set
  `PAYSTACK_USD_RATE`; the charge amount is frozen per attempt in `card_payments`.
- Short/wrong-currency charges and double payments are parked as `card_payments.status = 'review'` and
  alerted to Slack (`card_review`). Trend Pool refunds for card pledges go back through Paystack.

## 4a. Flutterwave — supplier payouts only

Flutterwave no longer takes buyer payments. It remains the payout rail out of escrow (and refunds pledges
paid before the switch). The webhook's `charge.completed` handling is kept only for checkouts started
before migration 011.

- Webhook URL: `https://<your-domain>/api/webhooks/flutterwave`, with the secret hash = `FLW_SECRET_HASH`.
- Enable **Transfers**. Keep the **USD balance** funded; FX payouts debit USD (`debit_currency=USD`).
- **IP whitelisting:** Vercel functions have no fixed egress IP. If your Flutterwave account enforces
  IP whitelisting for transfers, either use Vercel Secure Compute (static IPs) or set
  `FLW_OUTBOUND_PROXY_URL` to a static-IP HTTPS proxy and whitelist the proxy's IPs. Confirm with
  your Flutterwave account manager before go-live.

### 4b. M-Pesa (Safaricom Daraja STK Push)

Lipa na M-Pesa is the **default payment method for Trial Batch orders** when `NEXT_PUBLIC_MPESA_ENABLED=true`; card/bank checkout (Flutterwave) remains the fallback, and is used for orders above `MPESA_MAX_KES`. Trend Pool pledges stay on Flutterwave, because
their automatic refunds run through Flutterwave and refunding M-Pesa needs Safaricom's Reversal API.

1. **Sandbox:** create an app at https://developer.safaricom.co.ke (enable *M-Pesa Express*), copy the consumer
   key/secret, and take the test shortcode (`174379`) and passkey from *APIs → M-Pesa Express → Simulate*.
   Put them in `.env.local` and run `npm run mpesa:check` (OAuth only) or
   `npm run mpesa:check -- 07XXXXXXXX` (sends a KES 1 prompt and reports the result).
2. **Env vars** (Vercel, Production + Preview): `NEXT_PUBLIC_MPESA_ENABLED=true`, `MPESA_ENV`, `MPESA_CONSUMER_KEY`,
   `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_TOKEN` (`openssl rand -hex 24`),
   `MPESA_KES_PER_USD`, optionally `MPESA_TRANSACTION_TYPE`/`MPESA_PARTY_B` (Till) and `MPESA_MAX_KES`.
   `NEXT_PUBLIC_MPESA_ENABLED` is baked in at build time, so redeploy after changing it.
3. **Callback:** `https://<your-domain>/api/webhooks/daraja/<MPESA_CALLBACK_TOKEN>` — sent with every STK Push, so
   nothing to register. It must be public HTTPS: Preview deployments behind Vercel Deployment Protection
   will reject Safaricom (the order page still settles payments via STK Query polling).
4. **Go live:** apply for M-Pesa Express production access on the Daraja portal with your Paybill/Till, then switch
   `MPESA_ENV=production` and the production key/secret/shortcode/passkey.

How it works: `begin_mpesa_payment()` freezes the KES amount (order total × `MPESA_KES_PER_USD`, rounded up) before
the prompt is sent and allows one open prompt per order. Callbacks are unsigned, so an order is only funded after
Daraja's **STK Query** confirms the result (`apply_mpesa_payment()`). Double payments and amount mismatches are
parked as `mpesa_payments.status = 'review'` and alerted to Slack (`mpesa_review`), as are prompts unresolved
after 1h (`mpesa_unresolved`).

### DPO Pay, PayPal, Airtel Money, SWIFT and crypto (migration 028)

Each channel appears at checkout only when it is **configured** (env vars below) **and switched on** in
`/admin/financials → Payment gateways` (super admins; changes apply on the next page load, and are audited).

| Channel | Env vars | URL to register with the provider |
|---|---|---|
| DPO Pay | `DPO_COMPANY_TOKEN`, `DPO_SERVICE_TYPE`, optional `DPO_CURRENCY` + `DPO_USD_RATE`, `DPO_API_URL` | Push notifications: `https://<domain>/api/webhooks/dpo` |
| PayPal | `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | Webhook (events: Checkout order approved, Payment capture completed/denied/pending): `https://<domain>/api/payments/paypal/webhook` |
| Airtel Money | `AIRTEL_ENV`, `AIRTEL_CLIENT_ID`, `AIRTEL_CLIENT_SECRET`, `AIRTEL_COUNTRY`, `AIRTEL_USD_RATE`, `AIRTEL_CALLBACK_TOKEN`, optional `AIRTEL_CURRENCY`, `AIRTEL_MAX_AMOUNT` | Callback: `https://<domain>/api/webhooks/airtel/<AIRTEL_CALLBACK_TOKEN>` |
| SWIFT wire | none — enter the escrow bank account in `/admin/financials` | — |
| Crypto (USDT / USDC) | none — enter the deposit wallets in `/admin/financials` (off by default) | — |

How it works: DPO, PayPal and Airtel attempts are `card_payments` rows (`provider` = the gateway) whose amount is
frozen by `begin_gateway_payment()`. Webhooks, callbacks and the buyer's return are never trusted on their own:
the server asks the gateway (DPO `verifyToken`, PayPal capture / order lookup, Airtel status API) and only then
calls `apply_card_payment()`, which re-checks amount and currency. The retry-webhooks cron re-checks attempts
that never heard back and closes ones still unpaid after 48 h. Only Paystack charges are cross-checked by the
daily escrow reconciliation; the others are confirmed by their own sync.

Wire and crypto are manual: the buyer gets the bank details or wallet with a unique reference
(`manual_payments`), then uploads the bank receipt or submits the transaction hash. A super admin with 2FA
approves it in `/admin/financials → Wire & crypto approvals` after checking that the money arrived (amount,
reference, receiving address — the queue links each hash to the block explorer); approval funds escrow exactly
like an online payment. Unpaid orders with a transfer in progress get 14 days instead of 24 hours before expiring.
**Before enabling crypto, confirm you are licensed to hold virtual assets in your markets** (e.g. Kenya's VASP Act).

**Treasury:** M-Pesa collections settle into your Paybill/Till, not Flutterwave. Supplier payouts are Flutterwave
transfers from the USD balance, so sweep M-Pesa collections into that balance regularly. Keep `MPESA_KES_PER_USD`
current: it is the rate buyers pay at.

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
