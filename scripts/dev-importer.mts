// Create (or reuse) a confirmed test IMPORTER account for local checkout testing.
//
//   npm run dev:importer                         → importer.test@example.com, random password
//   npm run dev:importer -- --email=me+buyer@x.com --password=Secret-Pass-123
//   npm run dev:importer -- --yes                → required when Supabase isn't on localhost
//
// Reads .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Never
// changes an existing account's role: if the email belongs to a supplier/admin
// it stops. The profile row is created by the handle_new_user trigger.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('✗ Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('✗ Refusing to run with NODE_ENV=production');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1'].includes(host) && args.yes !== 'true') {
  console.error(`This creates a test importer account in the Supabase project at ${host}.`);
  console.error('Use a development project, then re-run with --yes to confirm.');
  process.exit(1);
}

const email = (args.email ?? 'importer.test@example.com').toLowerCase();
const password = args.password ?? `Test-${randomBytes(9).toString('base64url')}-9`;
if (password.length < 10) { console.error('✗ Password must be at least 10 characters'); process.exit(1); }

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(target: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const { data: created, error: createError } = await db.auth.admin.createUser({
  email, password, email_confirm: true,
  user_metadata: { role: 'importer', full_name: 'Test Importer', company_name: 'Test Boutique', country_code: 'KE' },
});

let userId = created?.user?.id ?? null;
if (createError) {
  if (!/already|registered|exists/i.test(createError.message)) { console.error(`✗ ${createError.message}`); process.exit(1); }
  userId = await findUserId(email);
  if (!userId) { console.error(`✗ ${email} exists but could not be found via the admin API`); process.exit(1); }
  const { data: profile } = await db.from('profiles').select('role').eq('id', userId).single();
  if (profile?.role !== 'importer') {
    console.error(`✗ ${email} is ${profile?.role ? `a ${profile.role}` : 'not an importer'} account. Roles are never changed by this script — pass a different --email.`);
    process.exit(1);
  }
  // Reuse the importer account; reset its password so the one printed below works.
  const { error } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) { console.error(`✗ ${error.message}`); process.exit(1); }
}

const { data: profile } = await db.from('profiles').select('role, company_name').eq('id', userId!).single();
if (profile?.role !== 'importer') {
  console.error('✗ Account created, but no importer profile row was found — is supabase/schema.sql (handle_new_user trigger) applied?');
  process.exit(1);
}

const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
console.log(`✓ Test importer ready (${createError ? 'existing account, password reset' : 'new account'})`);
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}`);
console.log(`  Sign in:  ${site}/login?redirectTo=%2Fdashboard`);
