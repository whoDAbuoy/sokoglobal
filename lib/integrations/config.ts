import { z } from 'zod';
import { MIN_SECRET_LENGTH } from './signature';

/**
 * Integration settings from the environment, validated. A target is "configured" only when
 * all of its variables are present and valid; anything half-set is reported, not used.
 *
 *   N8N_WEBHOOK_URL      n8n Webhook node URL that receives SokoGlobal events
 *   N8N_WEBHOOK_SECRET   32+ chars, shared with n8n: signs deliveries, verifies n8n's calls
 *   TWENTY_API_URL       Twenty server base URL (e.g. https://crm.example.com)
 *   TWENTY_API_KEY       Twenty → Settings → APIs & Webhooks → API key
 *
 * Plain http:// is accepted only outside production, for the local Docker stack.
 */
type Env = Record<string, string | undefined>;

const endpoint = (env: Env) => z.url({ protocol: /^https?$/ }).refine(
  (u) => u.startsWith('https://') || env.NODE_ENV !== 'production',
  'must use https:// in production',
);

export interface IntegrationConfig {
  n8n: { webhookUrl: string; secret: string } | null;
  twenty: { baseUrl: string; apiKey: string } | null;
  /** Variables that are set but invalid or incomplete. */
  problems: string[];
}

function section<T>(env: Env, names: string[], schema: z.ZodType<T>, problems: string[]): T | null {
  const values = Object.fromEntries(names.map((n) => [n, env[n]?.trim() || undefined]));
  if (Object.values(values).every((v) => v === undefined)) return null;
  const parsed = schema.safeParse(values);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) problems.push(`${issue.path.join('.') || names.join('/')}: ${issue.message}`);
  return null;
}

export function readIntegrationConfig(env: Env = process.env): IntegrationConfig {
  const problems: string[] = [];
  const n8n = section(env, ['N8N_WEBHOOK_URL', 'N8N_WEBHOOK_SECRET'], z.object({
    N8N_WEBHOOK_URL: endpoint(env),
    N8N_WEBHOOK_SECRET: z.string().min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`),
  }).transform((v) => ({ webhookUrl: v.N8N_WEBHOOK_URL, secret: v.N8N_WEBHOOK_SECRET })), problems);
  const twenty = section(env, ['TWENTY_API_URL', 'TWENTY_API_KEY'], z.object({
    TWENTY_API_URL: endpoint(env),
    TWENTY_API_KEY: z.string().min(20, 'looks too short for a Twenty API key'),
  }).transform((v) => ({ baseUrl: v.TWENTY_API_URL.replace(/\/+$/, ''), apiKey: v.TWENTY_API_KEY })), problems);
  return { n8n, twenty, problems };
}
