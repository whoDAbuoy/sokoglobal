import 'server-only';
import {
  buildLandedCostRequest, buildRateRequest, parseLandedCost, parseRates, parseTracking,
  type DhlDuties, type DhlQuote, type DhlTracking, type QuoteRequest,
} from './dhl';

/**
 * DHL Express network calls (server only; pure parts in ./dhl.ts).
 *   MyDHL API (rates, landed cost): HTTP Basic with DHL_EXPRESS_API_KEY / DHL_EXPRESS_API_SECRET and the
 *     shipper account DHL_EXPRESS_ACCOUNT_NUMBER. DHL_EXPRESS_ENV=production uses live pricing; anything else the test API.
 *   Shipment Tracking (Unified): DHL_TRACKING_API_KEY in the DHL-API-Key header. The default quota is about
 *     250 calls a day, so responses are cached for 15 minutes per waybill.
 * Without credentials every feature reports "not configured" and the app keeps working unchanged.
 */
export class DhlError extends Error {
  constructor(message: string, readonly httpStatus: number) { super(message); this.name = 'DhlError'; }
}

const MYDHL_BASE = process.env.DHL_EXPRESS_ENV === 'production' ? 'https://express.api.dhl.com/mydhlapi' : 'https://express.api.dhl.com/mydhlapi/test';
const TRACKING_URL = 'https://api-eu.dhl.com/track/shipments';
const TIMEOUT_MS = 12_000;

function mydhlConfig() {
  const key = process.env.DHL_EXPRESS_API_KEY, secret = process.env.DHL_EXPRESS_API_SECRET, account = process.env.DHL_EXPRESS_ACCOUNT_NUMBER;
  return key && secret && account ? { auth: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, account } : null;
}
export const isDhlRatesConfigured = () => mydhlConfig() !== null;
export const isDhlTrackingConfigured = () => !!process.env.DHL_TRACKING_API_KEY;
export const dhlAccountNumber = () => mydhlConfig()?.account ?? '';

/** DHL error bodies are RFC 7807-ish ({ title, detail, additionalDetails[] }). */
async function failure(res: Response): Promise<DhlError> {
  const body = await res.json().catch(() => null) as { title?: string; detail?: string; additionalDetails?: string[] } | null;
  const detail = [body?.detail, ...(body?.additionalDetails ?? [])].filter(Boolean).join(' ').slice(0, 300);
  return new DhlError(detail || body?.title || `DHL responded ${res.status}`, res.status);
}

async function mydhl(path: '/rates' | '/landed-cost', body: unknown): Promise<unknown> {
  const cfg = mydhlConfig();
  if (!cfg) throw new DhlError('DHL Express rates are not configured', 503);
  const res = await fetch(`${MYDHL_BASE}${path}`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: cfg.auth, 'Content-Type': 'application/json', Accept: 'application/json', 'Message-Reference': crypto.randomUUID() },
    body: JSON.stringify(body),
  }).catch((err: unknown) => { throw new DhlError(err instanceof Error && err.name === 'TimeoutError' ? 'DHL took too long to answer' : 'Could not reach DHL', 0); });
  if (!res.ok) throw await failure(res);
  return res.json();
}

/**
 * Freight quote, plus estimated duties and taxes when the listing has an HS code (DHL's landed-cost
 * service needs one). A landed-cost failure only drops the duties estimate; the freight quote stands.
 */
export async function fetchDhlQuote(q: QuoteRequest): Promise<{ quote: DhlQuote; duties: DhlDuties | null }> {
  const quote = parseRates(await mydhl('/rates', buildRateRequest(q)));
  if (!quote) throw new DhlError('DHL returned no Express service for this route', 422);
  let duties: DhlDuties | null = null;
  if (q.item?.hsCode) {
    try {
      duties = parseLandedCost(await mydhl('/landed-cost', buildLandedCostRequest({ ...q, item: q.item }, quote.productCode || 'P')));
    } catch (err) {
      console.warn('[dhl] landed cost unavailable', err instanceof Error ? err.message : err);
    }
  }
  return { quote, duties };
}

/** Live DHL Express tracking for one waybill; null when DHL has no record of it. */
export async function fetchDhlTracking(trackingNumber: string): Promise<DhlTracking | null> {
  const key = process.env.DHL_TRACKING_API_KEY;
  if (!key) throw new DhlError('DHL tracking is not configured', 503);
  const url = `${TRACKING_URL}?${new URLSearchParams({ trackingNumber, service: 'express' })}`;
  const res = await fetch(url, {
    headers: { 'DHL-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 900 },   // shared across viewers of the same waybill; keeps us inside DHL's daily quota
  }).catch(() => { throw new DhlError('Could not reach DHL', 0); });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  return parseTracking(await res.json());
}
