'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

test.describe('Badge de rôle (D)', () => {
  test('badge visible avec texte "reader"', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);

    const badge = page.locator('#role-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('reader');
  });

  test('badge visible avec texte "admin"', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);

    const badge = page.locator('#role-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('admin');
  });

  test('couleur différente reader vs admin', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);

    const readerColor = await page
      .locator('#role-badge')
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    await page.click('#logout');
    await page.waitForURL('/login');
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);

    const adminColor = await page
      .locator('#role-badge')
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(readerColor).not.toBe(adminColor);
  });

  test('badge présent sur la page Série', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/serie/onepiece');

    await expect(page.locator('#role-badge')).toBeVisible();
    await expect(page.locator('#role-badge')).toHaveText('reader');
  });

  test('badge présent dans le lecteur', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/reader/onepiece/comics/comics_a');

    await expect(page.locator('#role-badge')).toBeVisible();
    await expect(page.locator('#role-badge')).toHaveText('reader');
  });

  test('Déconnexion → redirection /login', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.click('#logout');
    await page.waitForURL('/login');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/api/me en échec (500) → header.js tente /login (D6)', async ({
    page,
  }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);

    // Intercepte /api/me → 500 (avant la navigation)
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal' }),
      })
    );

    // Navigue vers une page qui recharge header.js
    await page.goto('/serie/onepiece');

    // Attend le flag posé par header.js juste avant la redirection.
    // Le flag vit dans sessionStorage → persiste même si la navigation
    // rebondit (session encore valide → serveur /login → redirect /).
    await page.waitForFunction(
      () => {
        try {
          return sessionStorage.getItem('__headerRedirectAttempted') !== null;
        } catch {
          return false;
        }
      },
      { timeout: 5000 }
    );
  });
});