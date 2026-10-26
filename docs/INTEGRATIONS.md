# SokoGlobal — Integrations (n8n + Twenty CRM)

SokoGlobal sends a small set of platform events to **n8n** (supplier alerts over WhatsApp, Telegram, WeChat, SMS…) and to **Twenty CRM** (a pipeline per supplier). Nothing in checkout, escrow, payouts or chat calls these systems: database triggers write events to an outbox, and a separate job delivers them. If n8n or Twenty is down or not configured, events wait and the platform works exactly as before.

```
 RFQ / quote / escrow change / product chat / profile view
        │  (triggers, migration 033 — errors are swallowed, never block the action)
        ▼
 integration_outbox  (one row per event per target, service-role only)
        │  claim → validate (Zod) → deliver → finish, retried with backoff
        ▼
 /api/v1/webhooks/n8n ──► n8n webhook (HMAC-signed)      lib/integrations/outbox.ts
                      └─► Twenty REST API                 lib/services/crm-sync.ts
```

## Events

| Event | n8n | Twenty | Source |
|---|---|---|---|
| `rfq.created` | Alert to every supplier with a live listing in the category (buyer shown by country only) | Listing-specific RFQs only: Opportunity `NEW` in that supplier's pipeline | `rfqs` insert |
| `rfq.quote_submitted` | — | Opportunity moved `NEW → PROPOSAL` with the quoted value (created if new) | `rfq_quotes` insert (first quote only) |
| `escrow.status_changed` | Milestone message to buyer and supplier | — | `escrow_events` audit log (order creation excluded) |
| `lead.inquiry_created` | "New inquiry" alert to the supplier | Opportunity `NEW` | product `chat_threads` insert |
| `supplier.profile_viewed` | — | Note on the supplier and the buyer | `/dashboard/suppliers/[id]`, buyers only, once per buyer per supplier per day |

Privacy rules:
- n8n payloads are validated with **strict** schemas (`lib/integrations/events.ts`): a buyer's name or id can't slip into a supplier alert. RFQ alerts show the buyer's country, as the in-app RFQ feed does; inquiry alerts show the buyer's company, as the inbox does.
- Twenty receives buyer and supplier names and companies, never buyer emails or phone numbers, so deals stay on the platform and under escrow.
- Each recipient in an n8n delivery carries their own `opt_in` flags (`email_notifications`, `sms_alerts` from their profile). Have your workflows respect them. There is no WhatsApp/Telegram/WeChat preference or handle on profiles yet; until there is, use the phone number for WhatsApp and treat SMS opt-in as consent for messaging.

## Setup

### 1. Database

Apply `supabase/migrations/033_integration_outbox.sql` (after 032). `npm run test:db` replays it with the rest of the chain and runs `supabase/tests/033_integration_outbox.test.sql`.

### 2. Run n8n and Twenty

```bash
cp infrastructure/.env.integrations.example infrastructure/.env.integrations   # fill in the secrets
docker compose -f infrastructure/docker-compose.integrations.yml --env-file infrastructure/.env.integrations up -d
```

- n8n: http://localhost:5678. Twenty: http://localhost:3001 (3000 is the app's dev server).
- Images are pinned (n8n 2.43.0, Twenty v2.46.0, Postgres 16.14, Redis 7.4.10). Ports bind to 127.0.0.1. For staging, put a TLS proxy in front: the app refuses `http://` integration URLs when `NODE_ENV=production`.

### 3. Configure the app (`.env.local` / Vercel)

| Variable | Value |
|---|---|
| `N8N_WEBHOOK_URL` | URL of the n8n Webhook node below, e.g. `http://localhost:5678/webhook/sokoglobal-events` |
| `N8N_WEBHOOK_SECRET` | 32+ chars, the **same** value as in `infrastructure/.env.integrations` |
| `TWENTY_API_URL` | `http://localhost:3001` (staging: your https URL) |
| `TWENTY_API_KEY` | Twenty → Settings → APIs & Webhooks → create an API key |

A target is used only when both of its variables are set and valid. Half-set values are reported in the route's response (`problems`) and logs.

### 4. Deliver events every minute

`vercel.json` runs `GET /api/v1/webhooks/n8n` (Bearer `CRON_SECRET`) once a day as a safety net (the Hobby plan only allows daily crons). For near-instant alerts, let n8n trigger delivery every minute:

**Workflow "SokoGlobal: pull events"**: *Schedule Trigger* (every minute) → *Code* → *HTTP Request*.

Code node (JavaScript):
```js
const crypto = require('crypto');
const body = JSON.stringify({ limit: 200 });
const ts = Math.floor(Date.now() / 1000);
const sig = 'sha256=' + crypto.createHmac('sha256', $env.SOKOGLOBAL_WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
return [{ json: { body, ts: String(ts), sig } }];
```
HTTP Request node: `POST {{$env.SOKOGLOBAL_APP_URL}}/api/v1/webhooks/n8n`, headers `Content-Type: application/json`, `X-SokoGlobal-Timestamp: {{$json.ts}}`, `X-SokoGlobal-Signature: {{$json.sig}}`, raw body `{{$json.body}}`.

Request body (all optional): `{ "targets": ["n8n", "twenty"], "limit": 1–500 }`. The route answers 401 for a bad or stale (> 5 min) signature and 422 for an invalid body.

### 5. Receive events in n8n

**Workflow "SokoGlobal: events"**: *Webhook* (POST, path `sokoglobal-events`, respond immediately) → *Code* (verify, then one item per recipient) → *Switch* on `type` / channel → WhatsApp Business Cloud, Telegram, WeChat (Official Account / WeCom), SMS…

Every delivery is a POST with:
- `X-SokoGlobal-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>` and `X-SokoGlobal-Timestamp`
- `X-SokoGlobal-Event` (e.g. `rfq.created`) and `X-SokoGlobal-Delivery` (`evt_<id>`, stable across retries: de-duplicate on it)

```json
{
  "id": "evt_1042", "type": "rfq.created", "occurred_at": "2026-10-26T09:15:00+00:00", "attempt": 1,
  "data": { "rfq_id": "…", "title": "Electric kettles", "quantity": 500, "delivery_location": "Nairobi", "buyer_country": "KE", "…": "…" },
  "recipients": [
    { "party": "supplier", "user_id": "…", "company": "Sup Co", "country": "CN", "email": "…",
      "phone_e164": "+8613800000000", "whatsapp_id": "8613800000000",
      "opt_in": { "email": true, "sms": false }, "url": "https://<site>/supplier/rfqs" }
  ],
  "message": "New request for quotes on SokoGlobal from a buyer in KE: \"Electric kettles\" — 500 pieces, delivered to Nairobi. Quote before 9 Nov 2026."
}
```

Verify in the Code node (the body is compact `JSON.stringify` output, so re-serialising the parsed body reproduces it):
```js
const crypto = require('crypto');
const { headers, body } = $input.first().json;
const ts = headers['x-sokoglobal-timestamp'];
const expected = 'sha256=' + crypto.createHmac('sha256', $env.SOKOGLOBAL_WEBHOOK_SECRET).update(`${ts}.${JSON.stringify(body)}`).digest('hex');
const given = headers['x-sokoglobal-signature'] ?? '';
if (Math.abs(Date.now() / 1000 - Number(ts)) > 300 || given.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new Error('Bad SokoGlobal signature');
return body.recipients.map((r) => ({ json: { ...r, type: body.type, message: `${body.message} ${r.url}`, delivery: body.id } }));
```

Any non-2xx response is retried (backoff 2, 4, 8 … 64 minutes, 8 attempts), so return 2xx once the event is accepted.

## Twenty mapping

| SokoGlobal | Twenty | Link key (`crm_links`) |
|---|---|---|
| Supplier | Company | `company:supplier:<id>` |
| Buyer | Company `"<company> (<country>)"` + Person (point of contact) | `company:buyer:<id>`, `person:buyer:<id>` |
| RFQ × supplier | Opportunity `RFQ: <title>` | `opportunity:rfq:<rfq>:<supplier>` |
| Product inquiry | Opportunity `Inquiry: <product>` | `opportunity:inquiry:<thread>` |
| Profile view | Note + note targets | `note:profile_view:<supplier>:<buyer>:<date>` |

A supplier's pipeline is the opportunities whose company is that supplier (filter the Opportunities board by company). Stages use Twenty's defaults: `NEW`, then `PROPOSAL` when the supplier quotes. A quote never moves an opportunity that someone has already moved past `NEW`. If you renamed the stage options in Twenty, update `STAGE` in `lib/services/crm-sync.ts`.

## Operations

```sql
-- Backlog and failures per target
select target, status, count(*) from integration_outbox group by 1, 2 order by 1, 2;
select id, target, event_type, attempts, last_error from integration_outbox where status = 'failed' order by id desc limit 50;
-- Re-queue failures after fixing the cause
update integration_outbox set status = 'pending', attempts = 0, send_after = now(), last_error = null where status = 'failed';
```

The daily cron (`GET`) deletes outbox rows older than 30 days, whether or not a target is configured. Events for a target that isn't configured wait in the outbox until then, so switching a target on later never replays months-old alerts.
