import { expect, test } from '@playwright/test';
import { asRole, requireAccounts } from './helpers';

/**
 * Journey 3 — supplier order processing & messaging. Needs an existing chat
 * thread between the E2E importer and supplier (start one from any of the
 * supplier's products once). Messages stream over Supabase Realtime.
 */
test('supplier pipeline filters, and messages stream live both ways', async ({ browser }) => {
  requireAccounts('importer', 'supplier');
  const supplier = await asRole(browser, 'supplier');

  // Fulfilment pipeline: filter chips narrow the list without errors.
  await supplier.goto('/supplier#pipeline');
  const pipeline = supplier.locator('#pipeline');
  await expect(pipeline.getByRole('heading', { name: 'Fulfilment pipeline' })).toBeVisible();
  await pipeline.getByRole('button', { name: /in transit/i }).click();
  await expect(pipeline.getByRole('button', { name: /in transit/i })).toHaveAttribute('aria-pressed', 'true');
  await pipeline.getByRole('button', { name: /^all/i }).click();

  const importer = await asRole(browser, 'importer');
  await importer.goto('/dashboard/messages');
  const firstThread = importer.getByRole('region', { name: 'Conversations' }).getByRole('button').first();
  test.skip(!(await firstThread.isVisible().catch(() => false)), 'No chat thread between the E2E accounts yet');
  await firstThread.click();

  const token = `e2e-${Date.now()}`;
  await importer.getByLabel('Message').fill(`Quote check ${token}`);
  await importer.getByRole('button', { name: /send message/i }).click();
  await expect(importer.getByText(`Quote check ${token}`)).toBeVisible();

  await supplier.goto('/supplier/messages');
  await supplier.getByRole('region', { name: 'Conversations' }).getByText(`Quote check ${token}`, { exact: false }).click();
  await expect(supplier.getByText(`Quote check ${token}`).last()).toBeVisible();
  await supplier.getByLabel('Message').fill(`Confirmed ${token}`);
  await supplier.getByRole('button', { name: /send message/i }).click();

  // The importer's open thread receives the reply without a reload (Realtime).
  await expect(importer.getByText(`Confirmed ${token}`)).toBeVisible({ timeout: 20_000 });
});
