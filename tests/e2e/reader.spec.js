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

// ---------------------------------------------------------------------------
// V1.5.2 — Formats image modernes dans le lecteur classic
//
// On valide :
//   - 200 + Content-Type correct côté réseau
//   - présence de l'<img> dans le DOM avec la bonne src
//   - l'absence de crash du lecteur (indicateur de page correct)
//
// On ne valide PAS le décodage visuel des octets (le placeholder SVG
// du client peut s'afficher si le navigateur ne décode pas le format,
// comportement attendu et documenté §4 du CDC).
// ---------------------------------------------------------------------------

test.describe('Lecteur classic — formats modernes (V1.5.2)', () => {
  test('une image .jxl est intégrée dans le lecteur (DOM + réseau)', async ({
    page,
  }) => {
    await login(page);
    await waitForSeries(page);

    const responses = [];
    page.on('response', (r) => {
      if (r.url().includes('.jxl')) responses.push(r);
    });

    await page.goto('/reader/formats_v152/comics/jxl_a');
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 2');

    const img = page.locator('#page-container img').first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/\.jxl$/);

    const okJxl = responses.find(
      (r) => r.url().endsWith('.jxl') && r.status() === 200
    );
    expect(okJxl).toBeTruthy();
    expect(okJxl.headers()['content-type']).toBe('image/jxl');
  });

  test('une image .avif est intégrée dans le lecteur (DOM + réseau)', async ({
    page,
  }) => {
    await login(page);
    await waitForSeries(page);

    const responses = [];
    page.on('response', (r) => {
      if (r.url().includes('.avif')) responses.push(r);
    });

    await page.goto('/reader/formats_v152/comics/avif_a');
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 2');

    const img = page.locator('#page-container img').first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/\.avif$/);

    const okAvif = responses.find(
      (r) => r.url().endsWith('.avif') && r.status() === 200
    );
    expect(okAvif).toBeTruthy();
    expect(okAvif.headers()['content-type']).toBe('image/avif');
  });
});