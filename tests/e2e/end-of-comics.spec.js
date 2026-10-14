'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

/**
 * Navigue jusqu'à la dernière page d'un comics de test.
 * Pré-requis : server-fixture.js expose onepiece/comics/comics_a avec 3 pages.
 */
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

  test('V1.2 : overlay contient au plus 6 suggestions réelles', async ({
    page,
  }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();

    // Attend le rendu async des suggestions
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    // On ne compte QUE les suggestions réelles (exclut les slots vides)
    const count = await page
      .locator('#suggestions .card:not(.card-empty)')
      .count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(6);
  });

  test('V1.2 : les slots vides comblent jusqu\'à 6 emplacements', async ({
    page,
  }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    // onepiece a 3 comics normaux (a, b, c) → courant exclu → 2 suggestions
    // → 4 slots vides comblent à 6 (total = 6 li.card)
    const total = await page.locator('#suggestions .card').count();
    expect(total).toBe(6);

    const realCount = await page
      .locator('#suggestions .card:not(.card-empty)')
      .count();
    const emptyCount = await page
      .locator('#suggestions .card.card-empty')
      .count();
    expect(realCount + emptyCount).toBe(6);
  });

  test('suggestions ≠ comics courant', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    const names = await page
      .locator('#suggestions .card:not(.card-empty) h3')
      .allTextContents();
    expect(names).not.toContain('comics_a');
  });

  test('suggestions affichent une vraie vignette (pas le placeholder)', async ({
    page,
  }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#suggestions .card').first()).toBeVisible();

    const img = page
      .locator('#suggestions .card:not(.card-empty) img.thumb')
      .first();
    const src = await img.getAttribute('src');

    // Le src ne doit PAS être un data-URI (placeholder SVG)
    expect(src).not.toMatch(/^data:image\/svg/);
    // Il doit pointer vers /media/...
    expect(src).toMatch(/^\/media\//);
  });

  test('bouton Fermer → overlay disparaît', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.click('#close-overlay');
    await expect(page.locator('#end-overlay')).toBeHidden();
  });

  test("Échap dans l'overlay → ferme l'overlay (pas de nav)", async ({
    page,
  }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#end-overlay')).toBeHidden();
    await expect(page).toHaveURL(
      /\/reader\/onepiece\/comics\/comics_a$/
    );
  });

  test('bouton Retour au menu → page de la série', async ({ page }) => {
    await gotoLastPage(page);
    await page.click('#next');
    await expect(page.locator('#end-overlay')).toBeVisible();
    await page.click('#back-menu');
    await expect(page).toHaveURL(/\/serie\/onepiece$/);
  });
});