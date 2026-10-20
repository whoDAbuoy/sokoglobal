import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite (`npm run e2e`).
 *   • Smoke tests always run (landing, auth, route guards, headers, rate limits).
 *   • Critical journeys (checkout, profile approval, supplier messaging) need a
 *     Supabase project with test accounts — set E2E_* in .env.local or CI
 *     secrets (see .env.example); without them those tests are skipped.
 * E2E_BASE_URL targets a deployed preview instead of starting a local server.
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE lets CI/sandboxes reuse a preinstalled Chromium.
 */
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,          // journeys share test accounts
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : undefined } },
    { name: 'mobile', testMatch: /smoke\.spec\.ts/, use: { ...devices['Pixel 7'], launchOptions: executablePath ? { executablePath } : undefined } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
