import { expect, test } from '@playwright/test';
import { cents, requireAccounts, signIn } from './helpers';

/**
 * Journey 1 — importer checkout & landed cost. Stops at the payment step:
 * it never pays (no money moves, no escrow rows are funded).
 */
test('importer: landed cost scales with quantity, cart → checkout totals match', async ({ page }) => {
  requireAccounts('importer');
  await signIn(page, 'importer');
  await page.goto('/dashboard#batches');

  const card = page.locator('#batches article').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: /landed cost split/i })).toBeVisible();

  const total = card.getByText(/^\$[\d,]+\.\d{2}$/).last();   // Guaranteed Landed Cost figure
  const single = cents(await total.innerText());
  expect(single).toBeGreaterThanOrEqual(50_000);              // $500 Trial Batch minimum

  await card.getByRole('button', { name: /increase/i }).click();
  await expect.poll(async () => cents(await total.innerText())).toBe(single * 2);

  const add = card.getByRole('button', { name: /^add to cart$/i });
  if (await add.isVisible()) await add.click();
  await page.getByRole('button', { name: /^cart,/i }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /checkout/i }).first().click();

  await expect(page).toHaveURL(/\/dashboard\/checkout\//, { timeout: 30_000 });
  await expect(page.getByText(/escrow/i).first()).toBeVisible();
  const amounts = (await page.getByText(/\$[\d,]+\.\d{2}/).allInnerTexts()).map(cents);
  expect(amounts).toContain(single * 2);
});
