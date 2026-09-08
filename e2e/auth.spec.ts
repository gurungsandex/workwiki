import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';

/** Runs signed out, and deliberately spends one of the account's attempts. */
test.use({ storageState: { cookies: [], origins: [] } });

test('refuses the wrong password without saying which part was wrong', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill('definitely not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Either the generic failure or the lockout — never "no such account".
  await expect(page.locator('p[role="alert"]')).toContainText(/do not match an account here|locked for a few minutes/);
  await expect(page.locator('p[role="alert"]')).not.toContainText(/no account|unknown|not found/i);
});

test('an unknown address gets the same answer as a known one', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('nobody-here@example.invalid');
  await page.getByLabel('Password').fill('definitely not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/do not match an account here|Too many attempts/);
});

test('a reset request says the same thing whether or not the address exists', async ({ page }) => {
  await page.goto('/forgot');
  await page.getByLabel('Email').fill('nobody-here@example.invalid');
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.locator('p[role="status"]')).toContainText('If that address belongs to an account here');
});

test('every employee route redirects a signed-out visitor to sign in', async ({ page }) => {
  for (const route of ['/home', '/browse', '/search?q=x', '/help', '/org', '/my/acknowledgments']) {
    await page.goto(route);
    await expect(page).toHaveURL(/sign-in/);
  }
});

test('the admin console is not reachable signed out', async ({ page }) => {
  for (const route of ['/admin', '/admin/people', '/admin/access', '/admin/audit']) {
    await page.goto(route);
    await expect(page).toHaveURL(/sign-in/);
  }
});

test('an expired or invented invitation cannot be redeemed', async ({ page }) => {
  await page.goto('/register?token=not-a-real-token');
  await expect(page.getByRole('heading', { name: 'This invitation is no longer open' })).toBeVisible();
});

test('an invented reset link is refused', async ({ page }) => {
  await page.goto('/reset?token=not-a-real-token');
  await expect(page.getByRole('heading', { name: 'That link has expired' })).toBeVisible();
});
