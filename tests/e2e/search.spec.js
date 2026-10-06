'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

test.describe('Recherche live (A)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await expect(page.locator('#serie-title')).toHaveText('onepiece');
    await expect(page.locator('#comics-list .card').first()).toBeVisible();
  });

  test('saisie → résultats filtrés (debounce 250 ms)', async ({ page }) => {
    await page.fill('#search-input', 'comics_a');
    // Attendre le debounce
    await page.waitForTimeout(400);

    const cards = page.locator('#comics-list .card');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('comics_a');
  });

  test('substring insensible à la casse', async ({ page }) => {
    await page.fill('#search-input', 'COMICS');
    await page.waitForTimeout(400);
    // comics_a, comics_b, comics_c
    await expect(page.locator('#comics-list .card')).toHaveCount(3);
  });

  test('bouton ✕ → reset', async ({ page }) => {
    await page.fill('#search-input', 'zzz');
    await page.waitForTimeout(400);
    await page.click('#search-clear');
    await page.waitForTimeout(100);

    await expect(page.locator('#search-input')).toHaveValue('');
    // 3 comics + 1 corrupt_a = 4 ?
    // (fixtures serveur : comics_a, comics_b, comics_c, corrupt_a)
    const count = await page.locator('#comics-list .card').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('aucun résultat → tous les comics + message discret (A7)', async ({
    page,
  }) => {
    await page.fill('#search-input', 'introuvablexyz');
    await page.waitForTimeout(400);

    // Le champ reste rempli
    await expect(page.locator('#search-input')).toHaveValue('introuvablexyz');

    // Tous les comics sont affichés
    const count = await page.locator('#comics-list .card').count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Message discret
    await expect(page.locator('#no-results')).toBeVisible();
    await expect(page.locator('#no-results')).toContainText(/aucun résultat/i);
  });

  test('recherche scopée à l\'onglet actif (A9)', async ({ page }) => {
    // Onglet Comics : taper une recherche
    await page.fill('#search-input', 'comics_a');
    await page.waitForTimeout(400);
    await expect(page.locator('#comics-list .card')).toHaveCount(1);

    // Basculer sur Images → la recherche doit être vidée (A9)
    await page.click('[role="tab"][data-tab="img"]');
    await page.waitForTimeout(100);

    await expect(page.locator('#search-input')).toHaveValue('');
    // cover_a (img) reste affiché
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
    await expect(page.locator('#comics-list .card').first()).toContainText(
      'cover_a'
    );
  });

  test('recherche ne matche pas le numéro de page (A11)', async ({ page }) => {
    // comics_a a 3 pages. "3" ne doit pas le faire apparaître.
    await page.fill('#search-input', '3');
    await page.waitForTimeout(400);

    // Aucun comics ne contient "3" dans son nom
    // → tous les comics affichés + message "aucun résultat"
    await expect(page.locator('#no-results')).toBeVisible();
  });

  test('combinaison recherche + filtre [X,Y] (A10, C10)', async ({ page }) => {
    // comics_a=3, comics_b=1, comics_c=1, corrupt_a=1
    await page.fill('#search-input', 'comics');
    await page.fill('#filter-min', '2');
    await page.waitForTimeout(400);

    // comics_a (3 pages) matche, les autres non (1 page)
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
    await expect(page.locator('#comics-list .card').first()).toContainText(
      'comics_a'
    );
  });
});