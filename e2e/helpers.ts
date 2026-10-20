import { expect, test, type Browser, type Page } from '@playwright/test';

export type Role = 'importer' | 'supplier' | 'admin';

export function credentials(role: Role): { email: string; password: string } | null {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`];
  const password = process.env[`E2E_${role.toUpperCase()}_PASSWORD`];
  return email && password ? { email, password } : null;
}

/** Skip the current test unless every listed role has E2E credentials. */
export function requireAccounts(...roles: Role[]) {
  const missing = roles.filter((r) => !credentials(r));
  test.skip(missing.length > 0, `Set E2E_${missing.map((m) => m.toUpperCase()).join('_/E2E_')}_EMAIL and _PASSWORD to run this journey`);
}

export async function signIn(page: Page, role: Role) {
  const c = credentials(role)!;
  await page.goto('/login');
  await page.getByLabel('Work email').fill(c.email);
  await page.getByLabel('Password', { exact: true }).fill(c.password);
  await page.getByRole('button', { name: /sign in securely/i }).click();
  const home = role === 'admin' ? /\/admin/ : role === 'supplier' ? /\/supplier/ : /\/dashboard/;
  await expect(page).toHaveURL(home, { timeout: 30_000 });
}

/** A signed-in page in its own browser context (separate cookies per role). */
export async function asRole(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

/** "$1,234.50" → 123450 */
export const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);
