# SokoGlobal — B2B import marketplace (West → Africa)

> Production deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

MVP built with Next.js 15 (App Router) + Tailwind + Supabase (Postgres, Auth, Storage) + Lucide.

## Quick start

1. Create a Supabase project. In **SQL Editor**, run `supabase/schema.sql`, then
   `supabase/migrations/002_ops_payments_perf.sql`, `003_payouts_refunds_kyc_support.sql` and
   `004_tracking_and_vault.sql` and `005_admin_ops_reads.sql`.
2. `cp .env.example .env.local` and fill in the Supabase URL + anon key.
3. Supabase → Auth → URL Configuration: add `http://localhost:3000/auth/callback` as a redirect URL.
4. `npm install && npm run dev` → open http://localhost:3000/signup.
5. (Optional) Sign up one **Western Supplier**, then run `supabase/seed.sql` to load demo products & Trend Pools.
   Until then the buyer dashboard shows clearly labelled sample data.

## File map

| Area | Files |
|---|---|
| Database schema, RLS, escrow/pool functions, storage bucket | `supabase/schema.sql`, `supabase/seed.sql` |
| Auth UI (role choice: Western Supplier / African Importer) | `components/Auth.tsx`, `app/login`, `app/signup`, `app/auth/callback` |
| Auth state | `context/AuthContext.tsx`, `middleware.ts`, `lib/supabase/*` |
| Real-time image/swatch upload | `components/ImageUpload.tsx`, `app/api/uploads/sign`, `app/api/uploads/complete`, `lib/uploads.ts` |
| Buyer dashboard (Trust UI) | `app/dashboard/page.tsx`, `components/dashboard/*` |
| Supplier flow | `app/supplier/page.tsx`, `app/supplier/products/new`, `app/supplier/products/[id]` |
| Orders / escrow APIs | `app/api/orders`, `app/api/orders/[id]/confirm`, `app/api/pools/[id]/join` |
| Flutterwave escrow webhook | `app/api/webhooks/flutterwave/route.ts`, `lib/payments/flutterwave.ts`, `lib/supabase/admin.ts` |
| Ops / admin dashboard | `app/admin/page.tsx` (products), `app/admin/kyc` (supplier KYC), `app/admin/support` (agent inbox) |
| Checkout, payouts, refunds | `lib/payments/{flutterwave,checkout,payouts}.ts`, `app/api/orders/[id]/{checkout,confirm,dispute}`, `app/api/cron/*`, `vercel.json` |
| Buyer order page & support | `app/dashboard/orders/[id]`, `components/dashboard/SupportWidget.tsx` |
| Supplier verification | `app/supplier/verification` |
| Indexes, RLS tuning, admin + payment SQL | `supabase/migrations/002_ops_payments_perf.sql` |
| Tracking, Vault, FX, ops alerts SQL | `supabase/migrations/004_tracking_and_vault.sql` |
| Shipment tracking map | `components/tracking/{AnimatedShipmentMap,LeafletRouteLayer}.tsx`, `lib/tracking/route.ts` (+ tests) |
| FX payouts | `lib/payments/{fx,payouts,flutterwave}.ts` (+ `fx.test.mts`) |
| Ops alerting | `lib/notifications/slack.ts`, `app/api/cron/retry-payouts/route.ts` |
| Deployment | `vercel.json`, `next.config.ts` (security headers), `docs/DEPLOYMENT.md` |
| Admin shipment tracking | `app/admin/orders` (queue), `app/admin/orders/[id]/tracking` (form + live preview), `lib/tracking/validate.ts` |
| Payout reconciliation | `lib/payments/reconcile.ts`, `app/api/cron/reconcile-payouts/route.ts` |
| Content-Security-Policy | `lib/security/csp.ts`, `middleware.ts`, `app/api/csp-report/route.ts` |
| Tests (`npm test`) | `lib/**/*.test.mts`, `tests/*.test.mts` (41 tests) |

## How the trust rules are enforced (server-side, not just UI)

- **$500 Trial Batch / Guaranteed Landed Cost**: `trial_landed_cost_cents` is a generated column
  (goods + freight + customs). A product can't go live, and a trial order can't exist, below $500.
  `create_trial_order()` copies the price from the product row, so the client never sends a price.
- **Escrow**: users have no write access to `orders`. Status only changes through
  `confirm_delivery()` / `open_dispute()` (buyer) or the signed payment webhook (service role).
  Every change is logged in `escrow_events`.
- **Trend Pools**: `join_trend_pool()` locks the pool row, enforces min pledge / capacity / deadline,
  blocks over-funding, and calculates each boutique's pro-rata share of volumetric freight.
- **Visual proof**: photos must be ≥1000px; `submit_product_for_review()` requires ≥3 photos, and
  beauty products also need a swatch video. Uploads go straight to storage via one-time signed URLs,
  scoped to `{supplier_id}/{product_id}/`.
- **Roles / KYC**: column-level grants stop users from changing `role` or `kyc_verified`, or setting
  freight/customs quotes. Nobody can sign up as `admin`.

## Operations & payments (migration 002)

**Admin access.** Nobody can sign up as an admin. Create a normal account, then run:
`update public.profiles set role = 'admin' where id = '<user uuid>';` and open `/admin`.
Non-admins get a 404 there. Approvals go through `admin_approve_product()`, which re-checks the
admin role in Postgres, enforces the $500 minimum and records `reviewed_by` / `reviewed_at`.
"Send back" returns the product to draft, and the supplier sees your notes on their product page.

## Payments, payouts & refunds (migration 003)

All Flutterwave calls use the **v3 API** (`FLW_SECRET_KEY`). The money flow:

1. **Checkout**: `POST /api/orders` or `POST /api/pools/:id/join` returns `paymentLink`, and the browser
   redirects to it. Amount and `tx_ref` come from Postgres (`begin_payment_attempt`). Flutterwave needs a
   unique `tx_ref` per attempt, so retries are `ord_<id>-2`, `-3`, and so on. Retry an abandoned
   checkout with `POST /api/orders/:id/checkout`, or the pool card's "Complete payment" button.
2. **Funding**: the webhook (`/api/webhooks/flutterwave`) accepts the v3 `verif-hash` header or the v4
   `flutterwave-signature` HMAC. It re-verifies the charge with `GET /transactions/:id/verify`, then
   moves `pending_payment` → `funded`.
3. **Release & payout**: the buyer confirms on `/dashboard/orders/:id`. `confirm_delivery()` runs, then
   `processPayout()` calls `POST /transfers` to the supplier's verified account. Each attempt has a
   unique reference (`payout_<order>-<n>`), and the transfer id is recorded in `payouts` and
   `escrow_events`. `transfer.completed` webhooks mark the payout succeeded or failed.
   - Payouts are **held** if KYC isn't approved, the payout account isn't verified, or the account
     isn't in USD (other currencies need an FX quote, done manually).
   - Timeouts and 5xx errors stay `processing` and are never retried automatically, to avoid double
     payment. They resolve through the webhook, or ops reconcile them.
4. **Pool expiry**: `/api/cron/expire-pools` (hourly) expires open or funded pools past their deadline
   whose *paid* total is below target. Unpaid pledges are cancelled and paid ones fully refunded via
   `POST /transactions/:id/refund`. Overlapping runs can't double-refund (`SKIP LOCKED` claims). A refund
   is retried up to 5 times, then parked as `failed` for ops. A payment that arrives after a pool expired
   is accepted and queued for refund.
5. `/api/cron/retry-payouts` (hourly) re-attempts payouts that are held or failed (4xx). Both cron
   routes require `Authorization: Bearer $CRON_SECRET`.

**Flutterwave dashboard setup:** set the webhook URL to `https://<domain>/api/webhooks/flutterwave` with
the same secret hash as `FLW_SECRET_HASH`. Enable transfers (and IP-whitelist your server if your
account requires it), and keep the USD balance funded for payouts.

**KYC.** Suppliers complete `/supplier/verification`: business details, three documents (private
`kyc-documents` bucket) and a payout account. Ops review it at `/admin/kyc`, where documents open via
5-minute signed URLs. Approving sets `profiles.kyc_verified` and verifies the payout account through a
`SECURITY DEFINER` function that re-checks the admin role, then releases any held payouts. Changing the
payout account later un-verifies it and puts the supplier back in the queue, which blocks a
hijacked-account payout.

**Support.** The buyer widget has a FAQ modal, live chat per order (Supabase Realtime on
`support_messages`, filtered by RLS) and a dispute form (`POST /api/orders/:id/dispute`, which freezes
escrow and opens a case). Agents reply at `/admin/support`. The FAQ policy wording in
`SupportWidget.tsx` must be confirmed by Ops/Legal.

## Tracking, Vault, FX & alerting (migration 004)

**Shipment tracking.** Ops (or a logistics-partner integration using the service role) call
`admin_set_shipment_tracking()` / `set_shipment_tracking()` with the status, departure (`discharge_timestamp`),
ETA, origin/destination `{lat,lng}` and up to 500 `route_waypoints`; coordinates are validated in Postgres.
Escrow follows the shipment forward-only (in_transit → customs_cleared → delivered_pending_verification).
The order page renders `AnimatedShipmentMap`: `t = (now − discharge) / (eta − discharge)`, the marker moves
along great-circle legs **by distance**, and the badge flips to ARRIVED at `t ≥ 1` (display only).

```sql
select admin_set_shipment_tracking('<order id>', 'in_transit', now(), now() + interval '5 days',
  '{"lat":51.47,"lng":-0.4543}', '{"lat":-1.3192,"lng":36.9278}', '[{"lat":25.2532,"lng":55.3657}]',
  'London LHR', 'Nairobi JKIA');
```

**Vault.** Payout account numbers are Supabase Vault secrets (pgsodium TCE is pending deprecation, so
it isn't used). The table keeps only the secret id, last 4 digits and an HMAC fingerprint (pgcrypto, key in
Vault). Suppliers write through `upsert_payout_account()`. Admins see the full number only through
`admin_reveal_payout_account()`, which logs every reveal to `sensitive_access_log`. The KYC page flags
bank accounts shared between suppliers.

**FX payouts.** Non-USD payout accounts (KES, NGN, GHS, ZAR, EUR, GBP, …) are quoted with
`GET /transfers/rates` (a large probe for precision, then a confirming quote) and paid in local currency with
`debit_currency=USD`. The quote can never debit more than the supplier's USD net, and `record_payout_fx()`
enforces the same limit in SQL. The rate and amounts are stored on `payouts` and in the escrow audit trail.

**Slack alerts.** `/api/cron/retry-payouts` calls `pending_ops_alerts()` to gather payouts with no transfer
id, payouts with no completion webhook after 48 h, 5× failed payouts and refunds, stuck refunds and
payment mismatches. It posts them to `SLACK_WEBHOOK_URL` with their references. Each item is re-alerted at
most once per 24 h, is marked sent only after Slack accepts the message, and closes itself once fixed.

## Still to do before launch

- Ops/Legal sign-off on FAQ policy text (delivery window, customs-overrun guarantee, refund terms).
- Confirm with Flutterwave whether your account IP-whitelists transfers (see `docs/DEPLOYMENT.md` §4).
- CSP soak period in report-only mode, then `CSP_MODE=enforce` (see `docs/DEPLOYMENT.md` §5).
- Legal sign-off on the FAQ policy text.
