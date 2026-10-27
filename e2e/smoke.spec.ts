import { expect, test } from '@playwright/test';

/** Always-on checks that need no test accounts. */

test.describe('public pages', () => {
  test('landing: headline, interactive globe and calls to action', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Global trade that feels');
    const globe = page.getByRole('img', { name: /interactive globe showing sokoglobal trade corridors/i });
    await expect(globe).toBeVisible();
    await expect(page.getByRole('link', { name: /start importing/i })).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: /sell as a supplier/i })).toHaveAttribute('href', '/signup?role=supplier');
  });

  test('globe can be focused and rotated with the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard only');
    await page.goto('/');
    const globe = page.getByRole('img', { name: /interactive globe/i });
    await globe.focus();
    await expect(globe).toBeFocused();
    await page.keyboard.press('ArrowRight');   // must not scroll or throw
    await expect(globe).toBeFocused();
  });

  test('sign-in: split layout with labelled fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in securely/i })).toBeEnabled();
  });

  test('sign-up with ?role=supplier preselects the supplier account type', async ({ page }) => {
    await page.goto('/signup?role=supplier');
    await expect(page.getByRole('radio', { name: /western supplier/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: /create supplier account/i })).toBeVisible();
  });

  test('banned sessions land on a clear message', async ({ page }) => {
    await page.goto('/login?error=banned');
    await expect(page.getByRole('alert').filter({ hasText: 'suspended' })).toBeVisible();
  });

  test('reduced motion shows the first headline word, statically', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForTimeout(3000);   // longer than one word-rotation interval
    await expect(page.getByRole('heading', { level: 1 })).toContainText('effortless');
    await context.close();
  });
});

test.describe('guards and hardening', () => {
  for (const path of ['/dashboard', '/dashboard/messages', '/dashboard/discover', '/dashboard/settings', '/dashboard/kyc', '/supplier/orders', '/supplier', '/supplier/products/import', '/admin', '/admin/users', '/admin/reconciliation', '/admin/control', '/admin/categories']) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?redirectTo=${encodeURIComponent(path).replace(/%2F/g, '(%2F|/)')}`));
    });
  }

  test('view-as and the import template are not public', async ({ page, request }) => {
    await page.goto('/admin/view-as/44444444-4444-4444-8444-000000000001');
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    const tpl = await request.get('/supplier/products/import/template', { maxRedirects: 0 });
    expect(tpl.status()).toBe(307);
  });

  test('maintenance page renders with staff sign-in', async ({ page }) => {
    await page.goto('/maintenance');
    await expect(page.getByRole('heading', { name: /doing some maintenance/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /staff sign in/i })).toHaveAttribute('href', '/login');
  });

  test('2FA endpoints need a session; the challenge page sends visitors to sign in', async ({ page, request }) => {
    for (const path of ['enroll', 'verify', 'challenge', 'disable', 'backup-codes']) {
      expect((await request.post(`/api/auth/2fa/${path}`, { data: { code: '123456' } })).status(), path).toBe(401);
    }
    await page.goto('/auth/2fa');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard/profile?tab=security');
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
  });

  test('payment webhooks exist and reject unsigned calls', async ({ request }) => {
    for (const path of ['/api/webhooks/card', '/api/webhooks/paystack']) {
      const res = await request.post(path, { data: { event: 'charge.success', data: { reference: 'probe' } }, maxRedirects: 0 });
      expect(res.status(), `${path} must not redirect or 404`).not.toBe(404);
      expect([401, 500]).toContain(res.status());   // 401 forged signature · 500 when PAYSTACK_SECRET_KEY is unset
    }
  });

  test('documents and crons are not public', async ({ request }) => {
    const id = '44444444-4444-4444-8444-000000000001';
    expect((await request.get(`/api/orders/${id}/invoice`)).status()).toBe(401);
    expect((await request.get(`/api/payouts/${id}/receipt`)).status()).toBe(401);
    expect((await request.get('/api/cron/reconcile-escrow')).status()).toBe(401);
    expect((await request.get('/api/cron/retry-webhooks')).status()).toBe(401);
  });

  test('public pages load under the enforced CSP without violations', async ({ page, request }) => {
    const enforced = (await request.get('/login')).headers()['content-security-policy'];
    test.skip(!enforced, 'CSP_MODE is not enforce on this deployment');
    const violations: string[] = [];
    await page.exposeFunction('reportCspViolation', (v: string) => { violations.push(v); });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(`${e.violatedDirective} ${e.blockedURI} on ${location.pathname}`);
      });
    });
    for (const path of ['/', '/login', '/signup', '/products', '/legal/terms', '/legal/escrow', '/legal/privacy', '/no-such-page']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    expect(violations).toEqual([]);
  });

  test('security headers and CSP are present', async ({ request }) => {
    const res = await request.get('/login');
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy'] ?? h['content-security-policy-report-only']).toMatch(/script-src[^;]*'nonce-/);
  });

  test('checkout endpoints are rate limited', async ({ request }) => {
    let limited = false;
    for (let i = 0; i < 14 && !limited; i++) {
      const res = await request.post('/api/orders', { data: {}, headers: { 'x-forwarded-for': '203.0.113.77' } });
      if (res.status() === 429) {
        limited = true;
        expect(res.headers()['retry-after']).toBeTruthy();
      }
    }
    expect(limited).toBe(true);
  });
});
