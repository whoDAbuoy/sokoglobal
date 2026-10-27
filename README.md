# SokoGlobal — B2B import marketplace (West → Africa)

> Production deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

MVP built with Next.js 15 (App Router) + Tailwind + Supabase (Postgres, Auth, Storage) + Lucide.

## Quick start

1. Create a Supabase project and run `DATABASE_URL=<session pooler connection string> npm run db:migrate`
   (applies `supabase/schema.sql` and every migration, and records them; see docs/DEPLOYMENT.md §1).
2. `cp .env.example .env.local` and fill in the Supabase URL + anon key.
3. Supabase → Auth → URL Configuration: add `http://localhost:3000/**` as a redirect URL.
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
| User management (bans, deletes, profile-edit approval) | `app/admin/users`, `supabase/migrations/012_user_management.sql` (run it in the SQL editor; needs `SUPABASE_SERVICE_ROLE_KEY` on the server for Auth bans / deletes), `lib/user-admin.ts` |
| Portal messaging hub | `components/chat/MessagingHub.tsx`, `lib/chat-hub.ts` |
| Webhook dead-letter retries | `lib/payments/webhook-retry.ts`, `app/api/cron/retry-webhooks`, `supabase/migrations/013_payment_resilience.sql` |
| Escrow reconciliation | `lib/payments/{resilience,escrow-reconcile}.ts` (+ tests), `app/api/cron/reconcile-escrow`, `app/admin/reconciliation` |
| Monitoring (Sentry) | `instrumentation.ts`, `instrumentation-client.ts`, `sentry.{server,edge}.config.ts`, `lib/monitoring/sentry-options.ts` — off until `NEXT_PUBLIC_SENTRY_DSN` is set |
| Rate limiting (Upstash) | `lib/security/rate-limit{,-core}.ts`, applied in `middleware.ts` — set `UPSTASH_REDIS_REST_URL` / `_TOKEN` in production |
| Invoices & payout receipts (PDF) | `lib/documents/{model,pdf}.ts`, `app/api/orders/[id]/invoice`, `app/api/payouts/[id]/receipt` |
| E2E tests (Playwright) | `playwright.config.ts`, `e2e/` — `npm run e2e:install` once, then `npm run e2e`; journeys need the `E2E_*` accounts in `.env.example` |
| Super admin, temporary admins, kill switch, audit log | `supabase/migrations/014_super_admin.sql`, `lib/auth/admin-access.ts`, `lib/platform.ts`, `app/admin/control`, `app/admin/view-as/[userId]`, `middleware.ts` (maintenance mode) |
| Multi-commodity catalogue | `supabase/migrations/015_catalog.sql`, `lib/catalog.ts`, `lib/catalog-import.ts`, `app/dashboard/discover`, `app/supplier/products/{new,import}`, `app/admin/categories` |
| Settings hub, avatars, 2FA | `supabase/migrations/016_profiles_and_security.sql`, `app/dashboard/settings`, `app/api/auth/2fa`, `app/auth/2fa`, `lib/security/two-factor*.ts`, `lib/settings.ts`, `components/settings` |
| RFQs, display currencies, supplier shipments, milestone escrow, quick reorder | `supabase/migrations/021_enterprise_features.sql`, `lib/{rfq,currency,milestone,shipping,reorder}.ts` (+ tests), `app/{dashboard,supplier}/rfqs`, `context/CurrencyContext.tsx`, `components/{currency,rfq}`, `components/supplier/ShipOrderDialog.tsx`, `components/tracking/OrderTimeline.tsx`, `components/dashboard/QuickReorder.tsx`, `app/api/cron/restock-reminders` |
| Tests (`npm test`) | `lib/**/*.test.mts`, `tests/*.test.mts` (256 tests) |
| Database tests (`npm run test:db`, needs Docker) | `scripts/db-test.mjs` applies `schema.sql` + every migration to a throwaway Postgres with `supabase/tests/supabase-stubs.sql`, then runs `supabase/tests/*.test.sql` |

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

## Super admin & delegated admins (migration 014)

Run `014_super_admin.sql`, then `015_catalog.sql`, in the SQL editor (both are re-runnable). Then make the first super admin by hand:

```sql
update public.profiles set role = 'super_admin' where id = '<your auth user id>';
```

- **Levels**: `super_admin` (everything below plus audited overrides), `admin`, and **temporary admins**: any importer or
  supplier given a `delegated_admin_grants` row from `/admin/users` (switch in the Actions column, 1 hour to 30 days, reason
  required). `current_role_is('admin')` checks `now() < expires_at` and `revoked_at is null` on every call, so every existing
  admin policy and function honours grants and expiry with no app involvement. Revoking takes effect on the next request.
- **Super admin powers are explicit functions, not an RLS bypass.** Each `super_*` function re-checks `is_super_admin()`,
  requires a reason and writes `admin_audit_logs` (append-only by trigger, with IP and user agent):
  force-release escrow (then the normal payout starts), full / partial refunds (card refunds go through Paystack's refund API;
  M-Pesa refunds are recorded as *manual required* for finance), start or retry a payout, tracking number, landed cost before
  payment, account freeze, and catalogue status (draft / under review / published / delisted / featured).
- **View As** (`/admin/view-as/<user id>`, super admins) is a read-only inspector. It never uses the user's session, and
  every visit is audited.
- **Kill switch** (`/admin/control`, permanent admins only): pause new orders, halt checkout, maintenance mode, banner.
  Enforced by `BEFORE INSERT` triggers for user requests, in the order and payment API routes for service-role writes, and in
  `middleware.ts` for maintenance (non-admins see `/maintenance`; API calls get 503). Webhooks and cron keep running.
- **Freeze** blocks orders, payments, pledges and payouts for an account under dispute; the user can still sign in and message.

## Multi-commodity catalogue (migration 015)

- `categories` is an admin-managed tree (up to 4 levels, no cycles) seeded with Agriculture → Spices & Herbs → Vanilla Beans,
  coffee, grains, food, beauty, apparel, electronics, machinery, industrial, chemicals, minerals, home and health.
  Each node's `attribute_schema` lists the fields suppliers fill in and buyers filter on; children inherit them.
- Products gain `category_id`, `sku` (unique per supplier), `moq`, `unit_of_measure`, `price_tiers` and `is_featured`.
  The legacy `category` enum (`beauty` / `clothing` / new `general`) is kept in sync by trigger, so the beauty swatch-video
  rule and every older query keep working. Existing listings are backfilled.
- Suppliers: `/supplier/products/new` (cascading category, schema-driven specs, custom attributes, price tiers) and
  `/supplier/products/import` (CSV or Excel `.xlsx`, up to 500 rows, preview then import as drafts; template download).
- Buyers: `/dashboard/discover` (category tree, full-text search, attribute facets, featured first).
- Regulated categories (`requires_compliance`) show a notice to suppliers and a review warning to admins.

## RFQs, currencies, shipments, milestone escrow & restock reminders (migration 021)

Run `021_enterprise_features.sql` after 020, **before** deploying the app code that uses it.

- **Money model is unchanged**: escrow, payouts and reconciliation stay in USD cents, and every Paystack / M-Pesa amount is still
  computed in Postgres. KES is the *display* pivot: `exchange_rates.rate_to_kes` is KES per unit of each currency (KES, USD, UGX,
  TZS, RWF; seeded with placeholder rates — set real ones in **Control room → Display exchange rates**, audited as `fx.rate`).
- **Currency switcher** (header): `lib/currency.ts` (`formatCurrency(amountInKES, currency, rates)`, `formatUsdCents`), the
  `sg_currency` cookie (read on the server so SSR matches) and `<Price>` / `<LocalPreview>`. Converted amounts show "≈"; checkout
  keeps the charged USD amount and adds the local preview.
- **RFQs**: importers post requests at `/dashboard/rfqs` (`submit_rfq`); suppliers with a live listing in that category (or a
  sub-category) see them at `/supplier/rfqs` (`supplier_rfq_feed`) and send one private quote each against a listing, with
  optional bulk tiers, MOQ, validity and accepted payment terms (`submit_rfq_quote`). `accept_rfq_quote()` creates a locked
  `standard` order: quantity = max(request, MOQ), tier price × quantity in KES, converted to USD at the `exchange_rates` USD rate
  (frozen in `orders.fx_rate_to_kes`). RLS keeps quotes private; all writes go through the functions.
- **Milestone escrow** (`orders.payment_structure = 'milestone_30_70'`): for KYC-approved buyers on single orders of at least
  $1,000 (chosen on the order page, or fixed by an accepted quote). The buyer pays a 30% deposit (rounded up to the cent) →
  `deposit_paid`; the 70% balance becomes payable once the supplier dispatches, and paying it moves the order to the escrow state
  matching the shipment. Card and M-Pesa attempts record which leg they pay (`leg`). Release, force-release and payouts still need
  the full amount; refunds are capped at what was collected and cover both charges. `credit_30_days` is reserved in the schema
  but not offered yet.
- **Shipments**: suppliers use **Fulfil & ship** on `/supplier/orders` (`supplier_save_shipment`: waybill, carrier, tracking link,
  ETA; stages only move forward). It mirrors onto `orders.current_status` / tracking via `set_shipment_tracking()`, so the escrow
  timeline and map follow, and queues the buyer's dispatch (or balance-due) alert. Buyers see an Order placed → Payment escrowed →
  Dispatched → Delivered timeline with a carrier link on the order page.
- **Retention**: "Quick reorder" on `/dashboard/orders` refills the cart with the same batch quantities (Checkout re-prices);
  `queue_restock_reminders()` runs daily (pg_cron when available, plus `/api/cron/restock-reminders`) and emails buyers 30 and 60
  days after an order completes, unless they already reordered. Expired RFQs are closed by pg_cron and the expire-orders cron.

## More ways to pay: DPO Pay, Airtel Money, PayPal, SWIFT & crypto (migration 028)

Run `028_payment_gateways_expansion.sql` after 027 (it creates the private `payment-proofs` bucket). Setup:
`docs/DEPLOYMENT.md` → *DPO Pay, PayPal, Airtel Money, SWIFT and crypto*.

- Checkout (order page and cart checkout) groups methods in tabs: **Local Mobile Money** (M-Pesa, Airtel Money),
  **Cards & Pan-African** (card, DPO Pay), **Global Digital Payments** (PayPal), **B2B Bank Wire** (SWIFT) and
  **Crypto Escrow** (USDT / USDC). A method shows only when its switch in `platform_settings` is on and the
  gateway is configured; wire and crypto are per order (not carts).
- DPO / PayPal / Airtel reuse `card_payments` (`provider`, `gateway_token`): amounts frozen in
  `begin_gateway_payment()`, results confirmed with each gateway's API before `apply_card_payment()` funds escrow
  (`lib/payments/{dpo,paypal,airtel,gateways}.ts`). Webhooks: `/api/webhooks/dpo`, `/api/payments/paypal/webhook`,
  `/api/webhooks/airtel/<token>`; the retry cron re-checks attempts that never heard back.
- SWIFT / crypto: `manual_payments` (reference, bank or wallet snapshot, receipt in `payment-proofs` or tx hash,
  crypto handling fee). `/api/orders/<id>/wire-invoice` is the PDF of the wire instructions. Super admins with
  2FA approve or reject in `/admin/financials` (service-role `approve_manual_payment`, audited);
  `orders.payment_method` / `payment_metadata` record how an order was paid.
- `/admin/financials → Payment gateways`: switches, SWIFT escrow account, wallets and the crypto fee
  (`super_set_payment_settings()`, audited). Crypto is off by default.
- Tests: `supabase/tests/028_payment_gateways_expansion.test.sql`, `lib/payment-methods.test.mts`, `lib/payments/gateways.test.mts`.

## Platform monetization & financials (migration 026)

Run `026_platform_monetization.sql` after 025, **before** deploying the app code that reads its columns.

- **Pricing** lives on the existing single-row `platform_settings` (014's kill-switch row): Gold price and commission, standard
  commission, Featured RFQ and white-glove fees, escrow fee, FX spread, early-payout fee, logistics markup. Everyone can read it;
  only `super_set_platform_pricing()` writes it (super admins, validated, audited as `platform.pricing`). Edit it on
  **`/admin/financials`**, which also shows revenue per stream (`super_platform_revenue()`) and early-payout exposure.
- **Escrow fee**: new orders store `escrow_fee_cents` (escrow fee × goods + freight + customs; not Trend Pools) and `total_cents`
  now includes it, so card, M-Pesa, carts, milestone splits and refunds all charge it. Orders placed before 026 have no fee.
- **FX spread**: M-Pesa and non-USD card charges use base rate × (1 + spread); `fx_margin_cents` records it per payment.
- **Logistics markup**: the freight an admin enters on `/admin/review` is the carrier cost; approval adds the markup
  (`products.freight_markup_percent`, `orders.logistics_markup_cents`).
- **Gold Supplier** (`/supplier/subscription`): one month per card payment, no auto-renewal (`subscriptions`, `begin_card_purchase`
  → Paystack → `apply_card_payment`). Orders placed while Gold snapshot the Gold commission (`orders.commission_rate`; payouts use it,
  `PLATFORM_FEE_BPS` only covers older orders). Gold suppliers get a **Gold Supplier** badge on listings and quotes; the green
  **Verified** mark still means KYC only. Lapsed months are marked `past_due` by the expire-orders cron.
- **RFQ add-ons**: buyers tick **Promote as Featured RFQ** / **Request White-Glove Sourcing** when posting (or **Promote** later) and
  pay by card. A verified charge sets `rfqs.is_featured` (top of `supplier_rfq_feed()`) / `needs_white_glove` (opens a support
  ticket in `/admin/support`).
- **Instant early payout** (`/supplier/orders/[id]`): once an order is fully paid (milestone balance included) and dispatched with a
  waybill, its supplier can be paid before the buyer confirms delivery, minus the early-payout fee (`request_early_payout`, then
  the normal payout worker). SokoGlobal carries the risk: a later dispute is refunded from platform funds. The buyer's escrow
  timeline shows the early payout and that their protection is unchanged.
- Tests: `supabase/tests/026_platform_monetization.test.sql`, `lib/pricing.test.mts`.

## Admin messaging & direct support (migration 025)

Run `025_admin_and_order_chat.sql` after 024.

- `chat_threads.kind`: `product` · `order` · `direct`. A direct thread is SokoGlobal support ↔ one user (one per user, shared by all
  super admins; `start_direct_thread`). Super admins can read and post in every thread and delete messages; their messages get
  `from_admin` (set by the database) and show a **System / Admin message** badge, and the recipients get an email / SMS
  (`support.admin_message`, at most one per thread per hour). Admins observing a buyer ↔ supplier thread never mark it read.
- `/admin/messages` (super admins): every conversation, filtered by Order / Product / Direct and searchable; find any user by name,
  company or email to message them. **Message user** on `/admin/users` opens the same thread.
- Order chat now also opens when a quote is accepted (before payment); buyers get **Chat with Supplier** on the order page,
  suppliers **Message buyer** on accepted quotes and on `/supplier/orders`. Attachments and voice notes work in every thread
  (paths are `<order or thread id>/<sender>/<file>`).

## Order chat with media (migration 024)

Run `024_order_chat_and_media.sql` after 023 (it also creates the private `chat-attachments` bucket).

- Extends the buyer ↔ supplier chat from migration 009 (same tables, Realtime, unread counts and inbox): `chat_threads.order_id`
  gives each **paid** order its own thread between its buyer and the product's supplier (`start_order_chat`). Unpaid orders get
  none — suppliers can't see them (018).
- `chat_messages.message_type` (`text | image | video | document | voice_note`) + `metadata`. Attachments upload from the browser
  to `chat-attachments/<order_id>/<sender_id>/<file>` (private, 50 MB, PNG/JPG/WebP, MP4/WebM, PDF/XLSX/DOCX, WebM/Ogg/MP4 audio);
  a trigger checks the path, that the file exists, and takes size and type from Storage. The browser also checks file headers.
- UI: `components/chat/{ChatInput,ChatMessageItem,VoiceRecorder,VoicePlayer,EmojiPicker}.tsx` — emoji picker, attachments (also by
  drag and drop), voice notes with pause / cancel and a waveform, lightbox for photos and videos, document cards with download.
  Buyers use **Chat with Supplier** on the order page (opens the chat drawer); suppliers use **Message buyer** on `/supplier/orders`; all threads appear in Messages.
- `Permissions-Policy` now allows `microphone=(self)` for voice notes.

**Theme:** `THEME_INIT_SCRIPT` sets the `dark` class and `color-scheme` before first paint (also when storage is blocked);
`<html>` has no React-owned class, and `components/platform/ThemeSync.tsx` keeps the choice in sync (OS changes, other tabs).

## RFQ deletion, open visibility & share links (migration 022)

Run `022_rfq_deletion_and_sharing.sql` after 021.

- **Delete**: buyers can delete their own request while it is open or quoted (pending quotes go with it); super admins can delete any
  request (audited as `rfq.delete`). A request whose quote became an escrow order can't be deleted — cancel or refund the order.
- **Visibility**: every signed-in user can read live requests (open or quoted, before the deadline); `/supplier/rfqs` lists them
  all, matching categories first. Quoting still needs a live listing in the category, and quotes stay private.
- **Share links**: `/rfqs/<id>` opens a request directly (sign-in required); the Share button uses the Web Share API or copies the link.

## KYC, trial batch controls & paid-order visibility (migrations 017, 018)

Run `017_kyc_system.sql`, then `018_system_settings.sql`.

- **KYC (017)**: `profiles.kyc_status` (`unsubmitted | pending | approved | rejected`) is the flag every guard reads; it stays in sync
  with the older `kyc_verified` boolean used by payouts and badges. Suppliers keep `/supplier/verification` (business KYC +
  payout account); buyers use `/dashboard/kyc` (`kyc_verifications`: one identity document + one business document, files in the
  private `kyc-documents` bucket under `<uid>/verification/`). Super admins review them at `/admin/kyc?tab=identity`.
- **Guards**: creating listings and placing new escrow orders need `kyc_status = 'approved'`, enforced by insert triggers in
  Postgres and by middleware (listing pages redirect to verification; order APIs return 403). Payouts already require supplier
  KYC. Each guard can be switched off in **Control room → Marketplace rules** (`system_configs.kyc_requirements`).
- **Trial batches (018)**: `system_configs.trial_batch_config` (`enabled`, `minimum_amount` in USD). `trial_batch_min_cents()` and
  `check_trial_batch_validity()` read it, so approval, buy-now and cart checkout all follow the control-room switch; the old
  hard-coded $500 CHECK constraints are now config-aware triggers. Changes are audited (`config.*` in the audit log).
- **Paid-order visibility (018)**: `orders.fulfillment_status` is derived from escrow + shipment state. Suppliers can no longer
  read unpaid orders (RLS); an order becomes `pending_fulfillment` only when the service-role payment functions fund it after
  Paystack / M-Pesa verification, and a trigger refuses any user session that tries to move an order out of `pending_payment`.
  `/supplier/orders` shows one card per listing (`get_supplier_grouped_catalog()`): quantity and value waiting to ship, with
  each buyer's delivery details.

## Settings, avatars & two-factor authentication (migration 016)

Run `016_profiles_and_security.sql` and set `TWO_FACTOR_ENCRYPTION_KEY` (`openssl rand -base64 32`) in Vercel.

- `/dashboard/settings` (old `/dashboard/profile` links redirect): **Profile & identity** (photo, job title, phone; name and
  company still go through the reviewed change request), **Security & 2FA** (password, TOTP), **Notifications**, **Appearance**.
- **Avatars**: cropped to a 512 px JPEG in the browser (EXIF stripped), magic-byte checked on the server, stored content-hashed in
  the public `avatars` bucket under `<user id>/`. Storage policies and a profile trigger only allow the user's own folder.
- **2FA (TOTP, otplib + qrcode)**: `/api/auth/2fa/{enroll,verify,challenge,disable,backup-codes}`. Secrets are AES-256-GCM
  encrypted; ten single-use backup codes are stored as keyed hashes; a TOTP step is never accepted twice. 2FA switches on only
  after the server verifies a code. Rate limited (6/min).
- **Enforcement**: a pass is bound to the Supabase session (`session_id` in the JWT) for 12 hours (`two_factor_sessions`).
  Middleware sends unverified sessions to `/auth/2fa` and refuses their API calls; Postgres refuses audited admin actions from
  them, and money-moving overrides (force release, refunds, payouts, landed cost) require 2FA to be on.
- Notification preferences are stored on the profile (`email_notifications`, `sms_alerts`, `order_status_updates`) for the
  email / WhatsApp / SMS senders to read.

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
