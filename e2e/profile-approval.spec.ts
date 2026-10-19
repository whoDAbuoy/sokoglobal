import { expect, test } from '@playwright/test';
import { asRole, requireAccounts } from './helpers';

/**
 * Journey 2 — profile edit → admin approval queue. Approves a harmless change
 * (suffix " E2E") and then files and approves the reverse change, so the test
 * account ends where it started.
 */
test('importer requests a profile change, admin approves it, profile updates', async ({ browser }) => {
  requireAccounts('importer', 'admin');
  const importer = await asRole(browser, 'importer');
  const admin = await asRole(browser, 'admin');

  async function request(name: string) {
    await importer.goto('/dashboard/profile?tab=account');
    await importer.getByRole('button', { name: /request a change|replace pending request/i }).click();
    await importer.getByLabel('Business name').fill(name);
    await importer.getByRole('button', { name: /send for review/i }).click();
    await expect(importer.getByText(/sent for review/i)).toBeVisible();
  }
  async function approve(name: string) {
    await admin.goto('/admin/users');
    const card = admin.locator('li', { hasText: name }).filter({ has: admin.getByRole('button', { name: 'Approve' }) }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText(/approved — the profile is updated/i)).toBeVisible();
  }

  await importer.goto('/dashboard/profile?tab=account');
  const original = (await importer.locator('dt', { hasText: 'Business name' }).locator('xpath=following-sibling::dd').innerText()).trim();
  const changed = `${original.replace(/ E2E$/, '')} E2E`;

  await request(changed);
  await approve(changed);
  await importer.goto('/dashboard/profile?tab=account');
  await expect(importer.getByRole('heading', { level: 2 })).toBeVisible();
  await expect(importer.getByText(changed).first()).toBeVisible();

  // Restore the original name through the same workflow.
  await request(original.replace(/ E2E$/, ''));
  await approve(original.replace(/ E2E$/, ''));
});
