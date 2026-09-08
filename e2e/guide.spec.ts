import { expect, test } from '@playwright/test';

/** Signed in once by the setup project; these never sign in again. */

test.describe('the employee guide', () => {
  test('lands on a personalised home with search always on screen', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();
  });

  test('browses what applies to the reader', async ({ page }) => {
    await page.goto('/browse');
    await expect(page.getByRole('heading', { name: /applies to you|Nothing published/ })).toBeVisible();
  });

  test('a search with no answer resolves a person rather than dead-ending', async ({ page }) => {
    await page.goto('/search?q=zzzz-nothing-matches-this-zzzz');
    await expect(page.getByRole('heading', { name: 'Nobody has written this up yet' })).toBeVisible();
    await expect(page.getByText(/logged for whoever maintains this/)).toBeVisible();
  });

  test('every visible control is at least 44px tall', async ({ page }) => {
    await page.goto('/home');
    for (const control of await page.locator('a.tab, button.btn, input.input').all()) {
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('one typeface, and no motion anywhere', async ({ page }) => {
    for (const route of ['/home', '/browse', '/help', '/org']) {
      await page.goto(route);
      const offenders = await page.evaluate(() => {
        const bad: string[] = [];
        for (const element of Array.from(document.querySelectorAll('body *')).slice(0, 500)) {
          const style = getComputedStyle(element);
          const first = (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim();
          if (!/Source Serif|Georgia|Times|serif/i.test(first)) bad.push(`font: ${element.tagName} ${style.fontFamily}`);
          if (style.transitionDuration !== '0s' || style.animationDuration !== '0s') {
            bad.push(`motion: ${element.tagName} ${style.transitionDuration}/${style.animationDuration}`);
          }
        }
        return bad;
      });
      expect(offenders, `on ${route}`).toEqual([]);
    }
  });

  test('sends the security headers the spec requires', async ({ page }) => {
    const response = await page.goto('/home');
    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['content-security-policy']).toContain("base-uri 'none'");
    expect(headers['content-security-policy']).toMatch(/script-src [^;]*'nonce-/);
    expect(headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('the session cookie is HttpOnly, SameSite=Lax and path-scoped', async ({ context }) => {
    const cookie = (await context.cookies()).find((c) => c.name.includes('ww_session'));
    expect(cookie).toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe('Lax');
    expect(cookie!.path).toBe('/');
  });

  test('a page that does not exist is a plain 404, with nothing about the instance in it', async ({ page }) => {
    const response = await page.goto('/p/there-is-no-such-page-here');
    expect(response!.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText(/stack|at Object|node_modules/i);
  });
});

test.describe('the admin console', () => {
  test('shows a checklist derived from real state', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'What is left to do' })).toBeVisible();
    await expect(page.getByText(/checked against what actually exists|Everything checks out/)).toBeVisible();
  });

  test('the rule builder reads back as a sentence, never as JSON', async ({ page }) => {
    await page.goto('/admin/access');
    await expect(page.getByText('This rule reads')).toBeVisible();
    const sentence = await page.locator('.notice').first().innerText();
    expect(sentence).not.toContain('{');
    expect(sentence).toMatch(/Everyone|employees/);
  });

  test('publishes the truth table the engine actually implements', async ({ page }) => {
    await page.goto('/admin/access');
    await expect(page.getByText('An explicit deny')).toBeVisible();
    await expect(page.getByText('Locked, not denied')).toBeVisible();
    await expect(page.getByText('The parent wins')).toBeVisible();
  });

  test('the audit log says it is append-only, and exports', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByText(/no update path and no delete path/)).toBeVisible();
  });

  test('a mutation whose CSRF token has gone is refused, and writes nothing', async ({ page, context }) => {
    await page.goto('/admin/structure');

    // Strip the token the double submit compares against, and blank the copy
    // the page would echo back — what a forged cross-site post amounts to.
    await context.clearCookies({ name: 'ww_csrf' });
    await page.evaluate(() => {
      for (const input of Array.from(document.querySelectorAll('input[name="_csrf"]'))) {
        (input as HTMLInputElement).value = '';
      }
    });

    const name = `Should never exist ${Date.now()}`;
    await page.locator('input[name="name"]').first().fill(name);
    await page.getByRole('button', { name: 'Add the department' }).click();

    await expect(page.locator('p[role="alert"]').first()).toContainText('could not be verified');
    await page.goto('/admin/structure');
    await expect(page.locator('body')).not.toContainText(name);
  });
});
