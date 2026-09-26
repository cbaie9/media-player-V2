'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

async function gotoLastPage(page) {
  await login(page);
  await waitForSeries(page);
  await page.goto('/reader/onepiece/comics/comics_a');
  await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 3');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#page-indicator')).toHaveText('Page 3 / 3');
}

test.describe('Fin de comics', () => {
  test('dernière page + Suivant → overlay', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#end-title')).toHaveText('Fin du comics');
  });

  test('dernière page + clic droite → overlay', async ({ page }) => {
    await gotoLastPage(page);
    const box = await page.locator('#page-container').boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(page.locator('#end-overlay')).toBeVisible();
  });

  test('overlay contient au plus 3 suggestions', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();

    // ⬇️ ATTENDRE que le rendu async soit terminé avant de compter
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    const count = await page.locator('#suggestions .card').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
  });

  test('suggestions ≠ comics courant', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    const names = await page.locator('#suggestions .card h3').allTextContents();
    expect(names).not.toContain('comics_a');
  });

  test('bouton Fermer → overlay disparaît', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.click('#close-overlay');
    await expect(page.locator('#end-overlay')).toBeHidden();
  });

  test("Échap dans l'overlay → ferme l'overlay (pas de nav)", async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#end-overlay')).toBeHidden();
    await expect(page).toHaveURL(/\/reader\/onepiece\/comics\/comics_a$/);
  });

  test('bouton Retour au menu → page de la série', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.click('#back-menu');
    await expect(page).toHaveURL(/\/serie\/onepiece$/);
  });
});