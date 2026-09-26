'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

/**
 * Navigue jusqu'au lecteur d'un comics donné.
 */
async function gotoReader(page, serie = 'onepiece', folder = 'comics', name = 'comics_a') {
  await login(page);
  await waitForSeries(page);
  await page.goto(`/reader/${serie}/${folder}/${name}`);
  await expect(page.locator('#page-container img, #page-container video')).toBeVisible();
}

test.describe('Lecteur', () => {
  test('affiche la page 1 / 3 avec image', async ({ page }) => {
    await gotoReader(page);
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 3');
    await expect(page.locator('#page-container img')).toBeVisible();
  });

  test('flèche droite → page suivante', async ({ page }) => {
    await gotoReader(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 3');
  });

  test('flèche gauche → page précédente', async ({ page }) => {
    await gotoReader(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-indicator')).toHaveText('Page 3 / 3');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 3');
  });

  test('espace → page suivante', async ({ page }) => {
    await gotoReader(page);
    await page.keyboard.press('Space');
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 3');
  });

  test('Échap → retour à la page de la série', async ({ page }) => {
    await gotoReader(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/serie\/onepiece$/);
  });

  test('clic moitié droite → page suivante', async ({ page }) => {
    await gotoReader(page);
    const box = await page.locator('#page-container').boundingBox();
    // Clic à 80% de la largeur
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 3');
  });

  test('clic moitié gauche → page précédente', async ({ page }) => {
    await gotoReader(page);
    // Avance d'abord
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 3');

    const box = await page.locator('#page-container').boundingBox();
    // Clic à 20% de la largeur
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 3');
  });

  test('bouton Précédent désactivé en page 1', async ({ page }) => {
    await gotoReader(page);
    await expect(page.locator('#prev')).toBeDisabled();
  });

  test('bouton Précédent actif en page 2', async ({ page }) => {
    await gotoReader(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#prev')).toBeEnabled();
  });

  test('clic moitié gauche en page 1 ne change rien', async ({ page }) => {
    await gotoReader(page);
    const box = await page.locator('#page-container').boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 3');
  });
});