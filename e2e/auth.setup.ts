import { expect, test as setup } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'a fine long passphrase';

/**
 * Sign in once for the whole suite.
 *
 * Not a convenience: sign-in is rate-limited per account and locks after
 * repeated failures, so a suite that signs in for every test would be testing
 * the lockout rather than the product.
 */
setup('sign in', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/home');
  await expect(page.getByRole('search')).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
