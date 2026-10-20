#!/usr/bin/env node
/**
 * One-time Sentry setup for SokoGlobal (run on your own machine):
 *
 *   SENTRY_SETUP_TOKEN=sntryu_xxx node scripts/sentry-setup.mjs
 *   # or: npm run sentry:setup   (reads SENTRY_SETUP_TOKEN from the environment)
 *
 * What it does (idempotent — safe to re-run):
 *   1. Finds your organization (default slug: sokoglobal) and its data region (US / EU).
 *   2. Finds or creates the team (default: sokoglobal).
 *   3. Finds or creates ONE Next.js project (default: sokoglobal-web). Client, server and
 *      edge events all go to it; production / preview / development are told apart by
 *      the `environment` tag (SENTRY_ENVIRONMENT / VERCEL_ENV).
 *   4. Reads the project's client key and prints the exact environment variables to add
 *      to Vercel and .env.local (DSN, org, project, CSP report endpoint).
 *
 * The token needs these scopes: org:read, team:read, team:write, project:read, project:write.
 * Create it at Sentry → User Settings → Personal Tokens, run this script, then delete the
 * token. It is read from the environment only and never written to disk or printed.
 * (Source-map uploads use a separate Organization Auth Token — see the printed steps.)
 *
 * Options (env vars): SENTRY_ORG, SENTRY_TEAM, SENTRY_PROJECT, SENTRY_URL (default https://sentry.io).
 */

const token = process.env.SENTRY_SETUP_TOKEN;
const org = process.env.SENTRY_ORG || 'sokoglobal';
const teamSlug = process.env.SENTRY_TEAM || 'sokoglobal';
const projectSlug = process.env.SENTRY_PROJECT || 'sokoglobal-web';
let base = (process.env.SENTRY_URL || 'https://sentry.io').replace(/\/+$/, '');

if (!token) {
  console.error('Set SENTRY_SETUP_TOKEN to a Sentry personal token (scopes: org:read, team:read, team:write, project:read, project:write).');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${base}/api/0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function fail(step, r) {
  const detail = typeof r.data === 'object' && r.data ? (r.data.detail ?? JSON.stringify(r.data)) : String(r.data ?? '');
  console.error(`✗ ${step} failed (HTTP ${r.status}): ${detail}`);
  if (r.status === 401) console.error('  The token is invalid or expired.');
  if (r.status === 403) console.error('  The token is missing a scope, or your role in the organization cannot do this (Manager/Owner needed to create teams/projects).');
  process.exit(1);
}

// 1. Organization (+ data region: EU orgs live on de.sentry.io)
let r = await api('GET', `/organizations/${org}/`);
if (r.status !== 200) fail(`Reading organization "${org}"`, r);
const regionUrl = r.data?.links?.regionUrl;
if (regionUrl && regionUrl.replace(/\/+$/, '') !== base) {
  base = regionUrl.replace(/\/+$/, '');
}
console.log(`✓ Organization: ${r.data.name} (${org}) · region ${base}`);

// 2. Team
r = await api('GET', `/organizations/${org}/teams/`);
if (r.status !== 200) fail('Listing teams', r);
let team = r.data.find((t) => t.slug === teamSlug);
if (!team) {
  r = await api('POST', `/organizations/${org}/teams/`, { name: 'SokoGlobal', slug: teamSlug });
  if (r.status !== 201 && r.status !== 200) fail(`Creating team "${teamSlug}"`, r);
  team = r.data;
  console.log(`✓ Created team: ${team.slug}`);
} else {
  console.log(`✓ Team exists: ${team.slug}`);
}

// 3. Project
r = await api('GET', `/projects/${org}/${projectSlug}/`);
let project;
if (r.status === 200) {
  project = r.data;
  console.log(`✓ Project exists: ${project.slug} (${project.platform ?? 'no platform'})`);
} else if (r.status === 404) {
  r = await api('POST', `/teams/${org}/${team.slug}/projects/`, { name: 'SokoGlobal Web', slug: projectSlug, platform: 'javascript-nextjs', default_rules: true });
  if (r.status !== 201 && r.status !== 200) fail(`Creating project "${projectSlug}"`, r);
  project = r.data;
  console.log(`✓ Created project: ${project.slug} (javascript-nextjs, default alert rules on)`);
} else {
  fail(`Reading project "${projectSlug}"`, r);
}

// 4. Client key (DSN)
r = await api('GET', `/projects/${org}/${project.slug}/keys/`);
if (r.status !== 200) fail('Reading client keys', r);
let key = (r.data ?? []).find((k) => k.isActive !== false);
if (!key) {
  r = await api('POST', `/projects/${org}/${project.slug}/keys/`, { name: 'SokoGlobal web' });
  if (r.status !== 201 && r.status !== 200) fail('Creating a client key', r);
  key = r.data;
}
const dsn = key?.dsn?.public;
const security = key?.dsn?.security;
if (!dsn) fail('Reading the DSN', { status: 200, data: 'no public DSN on the key' });

const host = new URL(base).host;
console.log(`
──────────────────────────────────────────────────────────────────────────
Add these to Vercel → Project → Settings → Environment Variables
(Production + Preview + Development) and to .env.local:

NEXT_PUBLIC_SENTRY_DSN=${dsn}
SENTRY_ORG=${org}
SENTRY_PROJECT=${project.slug}${host !== 'sentry.io' ? `\nSENTRY_URL=${base}` : ''}
${security ? `
Optional — send CSP violation reports to Sentry instead of /api/csp-report:
CSP_REPORT_URI=${security}&sentry_environment=production
` : ''}
Source maps (readable stack traces) — build-time only, never NEXT_PUBLIC_:
  1. Sentry → Settings → Auth Tokens (organization tokens) → Create New Token
  2. Add it in Vercel as SENTRY_AUTH_TOKEN (Production + Preview only)

Then redeploy, sign in as an admin and open /api/admin/sentry-test — a
"SokoGlobal Sentry test event" should appear in the project's Issues within a minute.
──────────────────────────────────────────────────────────────────────────
Done. You can now delete SENTRY_SETUP_TOKEN in Sentry → User Settings → Personal Tokens.`);
