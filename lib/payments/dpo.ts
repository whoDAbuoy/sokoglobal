import 'server-only';

/**
 * DPO Pay (Network International) — hosted payment page for cards and African mobile money.
 *
 *   1. createToken (XML API v6) with our reference as CompanyRef → TransToken
 *   2. Buyer pays on https://secure.3gdirectpay.com/payv2.php?ID=<TransToken>
 *   3. DPO redirects back (RedirectURL + TransactionToken) and may POST a push notification;
 *      neither is trusted: verifyToken asks DPO for the result and the amount actually paid,
 *      then apply_card_payment() funds escrow (amount and currency are re-checked there).
 *
 * DPO_CURRENCY defaults to USD; for another currency set DPO_USD_RATE (units per USD).
 */
export class DpoError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly code?: string) {
    super(message);
    this.name = 'DpoError';
  }
  get retryable() { return this.httpStatus === 0 || this.httpStatus >= 500; }
}

export interface DpoConfig { apiBase: string; companyToken: string; serviceType: string; currency: string; usdRate: number }

export function dpoConfig(): DpoConfig {
  const companyToken = process.env.DPO_COMPANY_TOKEN;
  const serviceType = process.env.DPO_SERVICE_TYPE;
  if (!companyToken || !serviceType) throw new DpoError('DPO Pay is not configured (DPO_COMPANY_TOKEN / DPO_SERVICE_TYPE missing)', 500);
  const currency = (process.env.DPO_CURRENCY || 'USD').toUpperCase();
  const usdRate = currency === 'USD' ? 1 : Number(process.env.DPO_USD_RATE);
  if (!(usdRate > 0)) throw new DpoError(`DPO_USD_RATE must be set for ${currency} charges`, 500);
  return { apiBase: (process.env.DPO_API_URL || 'https://secure.3gdirectpay.com').replace(/\/$/, ''), companyToken, serviceType, currency, usdRate };
}

export function isDpoConfigured(): boolean {
  try { dpoConfig(); return true; } catch { return false; }
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Minor units → "1234.56". */
export const majorAmount = (minor: number) => (minor / 100).toFixed(2);

/** "1234.56" / "1,234.5" → 123456 minor units; null when unparseable. */
export function toMinor(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Text of the first <tag>…</tag> (no attributes in DPO responses), entities decoded. */
export function xmlValue(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return undefined;
  return m[1].trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** "YYYY/MM/DD HH:MM" as DPO's ServiceDate expects. */
export function serviceDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}/${p(now.getUTCMonth() + 1)}/${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;
}

export function createTokenXml(cfg: Pick<DpoConfig, 'companyToken' | 'serviceType'>, t: {
  amountMinor: number; currency: string; reference: string; redirectUrl: string; backUrl: string; description: string;
  customerEmail?: string; customerName?: string;
}, now = new Date()): string {
  const [first, ...rest] = (t.customerName ?? '').trim().split(/\s+/);
  return `<?xml version="1.0" encoding="utf-8"?>
<API3G>
<CompanyToken>${escapeXml(cfg.companyToken)}</CompanyToken>
<Request>createToken</Request>
<Transaction>
<PaymentAmount>${majorAmount(t.amountMinor)}</PaymentAmount>
<PaymentCurrency>${escapeXml(t.currency)}</PaymentCurrency>
<CompanyRef>${escapeXml(t.reference)}</CompanyRef>
<RedirectURL>${escapeXml(t.redirectUrl)}</RedirectURL>
<BackURL>${escapeXml(t.backUrl)}</BackURL>
<CompanyRefUnique>1</CompanyRefUnique>
<PTL>60</PTL>
${t.customerEmail ? `<customerEmail>${escapeXml(t.customerEmail)}</customerEmail>` : ''}
${first ? `<customerFirstName>${escapeXml(first)}</customerFirstName>` : ''}
${rest.length ? `<customerLastName>${escapeXml(rest.join(' '))}</customerLastName>` : ''}
</Transaction>
<Services>
<Service>
<ServiceType>${escapeXml(cfg.serviceType)}</ServiceType>
<ServiceDescription>${escapeXml(t.description.slice(0, 120))}</ServiceDescription>
<ServiceDate>${serviceDate(now)}</ServiceDate>
</Service>
</Services>
</API3G>`;
}

export const verifyTokenXml = (companyToken: string, token: string) => `<?xml version="1.0" encoding="utf-8"?>
<API3G>
<CompanyToken>${escapeXml(companyToken)}</CompanyToken>
<Request>verifyToken</Request>
<TransactionToken>${escapeXml(token)}</TransactionToken>
</API3G>`;

export type DpoState = 'paid' | 'pending' | 'failed';
/** verifyToken result codes: 000 paid; 900 not paid yet; 901 declined; 902 data mismatch; 903 expired; 904 cancelled. */
export function dpoState(result: string | undefined): DpoState {
  if (result === '000') return 'paid';
  if (result === '900' || result === '003' || result === '007') return 'pending';
  return 'failed';
}

export interface DpoVerification {
  state: DpoState; result: string; explanation: string;
  amountMinor: number | null; currency: string | null; approval: string | null; companyRef: string | null;
}
export function parseVerifyResponse(xml: string): DpoVerification {
  const result = xmlValue(xml, 'Result') ?? '';
  return {
    state: dpoState(result), result, explanation: xmlValue(xml, 'ResultExplanation') ?? '',
    amountMinor: toMinor(xmlValue(xml, 'TransactionAmount')),
    currency: xmlValue(xml, 'TransactionCurrency')?.toUpperCase() ?? null,
    approval: xmlValue(xml, 'TransactionApproval') ?? null,
    companyRef: xmlValue(xml, 'CompanyRef') ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

async function post(xml: string, cfg: DpoConfig): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/API/v6/`, {
      method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml, cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new DpoError(`DPO Pay unreachable: ${(err as Error).message}`, 0);
  }
  const text = await res.text();
  if (!res.ok) throw new DpoError(`DPO Pay request failed (${res.status})`, res.status);
  return text;
}

export const dpoPaymentUrl = (token: string, cfg = dpoConfig()) => `${cfg.apiBase}/payv2.php?ID=${encodeURIComponent(token)}`;

export async function createToken(t: Parameters<typeof createTokenXml>[1]): Promise<{ token: string; transRef: string | null }> {
  const cfg = dpoConfig();
  const xml = await post(createTokenXml(cfg, t), cfg);
  const result = xmlValue(xml, 'Result');
  const token = xmlValue(xml, 'TransToken');
  if (result !== '000' || !token) throw new DpoError(`DPO Pay refused the payment: ${xmlValue(xml, 'ResultExplanation') ?? result ?? 'unknown error'}`, 400, result);
  return { token, transRef: xmlValue(xml, 'TransRef') ?? null };
}

/** Never trust the redirect or push: ask DPO. */
export async function verifyToken(token: string): Promise<DpoVerification> {
  const cfg = dpoConfig();
  return parseVerifyResponse(await post(verifyTokenXml(cfg.companyToken, token), cfg));
}
