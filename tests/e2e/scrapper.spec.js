'use strict';

const { test, expect } = require('@playwright/test');

const ADMIN = { username: 'admin', password: 'admin_pw' };
const READER = { username: 'reader', password: 'reader_pw' };

async function login(page, creds) {
  await page.goto('/login');
  await page.fill('input[name="username"]', creds.username);
  await page.fill('input[name="password"]', creds.password);
  await Promise.all([
    page.waitForURL('/'),
    page.click('button[type="submit"]'),
  ]);
}

async function openScrapper(page) {
  await page.goto('/scrapper');
  // Attendre que le module soit prêt
  await page.waitForSelector('#scrapper-form', { state: 'visible' });
}

test.describe('Scrapper V1.5', () => {
  test('admin voit le lien "Scrapper" dans la nav', async ({ page }) => {
    await login(page, ADMIN);
    const link = page.locator('#nav-scrapper');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/scrapper');
  });

  test('reader ne voit PAS le lien "Scrapper"', async ({ page }) => {
    await login(page, READER);
    // Le lien existe dans le DOM mais reste hidden (cfg.roles = ['admin'])
    const link = page.locator('#nav-scrapper');
    await expect(link).toBeHidden();
  });

  test('succès complet : 3 segments verts + end "ok"', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await page.fill('#scrapper-input', 'ok');
    await page.click('#scrapper-submit');

    // Attendre la fin
    await expect(
      page.locator('#scrapper-lines .scrapper-line--meta')
    ).toContainText(/\[fin\].*ok/, { timeout: 15000 });

    // 3 segments en statut "done"
    for (const phase of [1, 2, 3]) {
      await expect(
        page.locator(`.scrapper-seg[data-phase="${phase}"]`)
      ).toHaveAttribute('data-status', 'done');
    }
  });

  test('échec phase 2 : segment 2 en rouge', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await page.fill('#scrapper-input', 'fail-phase-2');
    await page.click('#scrapper-submit');

    await expect(
      page.locator('.scrapper-seg[data-phase="2"]')
    ).toHaveAttribute('data-status', 'error', { timeout: 15000 });

    // stderr visible en rouge
    await expect(
      page.locator('#scrapper-lines .scrapper-line--stderr').first()
    ).toBeVisible();
  });

  test('input désactivé pendant le run, réactivé à la fin', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await page.fill('#scrapper-input', 'ok');
    await page.click('#scrapper-submit');

    // Pendant le run
    await expect(page.locator('#scrapper-input')).toBeDisabled();
    await expect(page.locator('#scrapper-submit')).toBeDisabled();

    // À la fin
    await expect(
      page.locator('#scrapper-lines .scrapper-line--meta')
    ).toContainText(/\[fin\]/, { timeout: 15000 });
    await expect(page.locator('#scrapper-input')).toBeEnabled();
    await expect(page.locator('#scrapper-submit')).toBeEnabled();
  });

  test('crash sans marqueur → phase 1 en rouge (D18)', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await page.fill('#scrapper-input', 'crash');
    await page.click('#scrapper-submit');

    await expect(
      page.locator('.scrapper-seg[data-phase="1"]')
    ).toHaveAttribute('data-status', 'error', { timeout: 15000 });
  });
});