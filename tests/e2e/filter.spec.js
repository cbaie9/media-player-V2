'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

test.describe('Filtre [X,Y] + tri (C)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await expect(page.locator('#comics-list .card').first()).toBeVisible();
  });

  test('saisie X/Y → liste filtrée', async ({ page }) => {
    await page.fill('#filter-min', '2');
    await page.waitForTimeout(400);

    // Seul comics_a (3 pages) reste
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
    await expect(page.locator('#comics-list .card').first()).toContainText(
      'comics_a'
    );
  });

  test('max seul → filtre inclusif', async ({ page }) => {
    await page.fill('#filter-max', '1');
    await page.waitForTimeout(400);

    // onepiece contient 3 comics : comics_a (3 pages), comics_b (1),
    // comics_c (1). Avec max=1 → comics_b + comics_c = 2.
    const count = await page.locator('#comics-list .card').count();
    expect(count).toBe(2);
  });

  test('tri alphabétique (défaut)', async ({ page }) => {
    await page.selectOption('#filter-sort', 'alpha');
    await page.waitForTimeout(100);

    const names = await page
      .locator('#comics-list .card .meta h3')
      .allTextContents();
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('tri pages croissant', async ({ page }) => {
    await page.selectOption('#filter-sort', 'pages_asc');
    await page.waitForTimeout(100);

    const texts = await page
      .locator('#comics-list .card .meta p')
      .allTextContents();
    const counts = texts.map((t) => parseInt(t, 10));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  test('tri pages décroissant', async ({ page }) => {
    await page.selectOption('#filter-sort', 'pages_desc');
    await page.waitForTimeout(100);

    const texts = await page
      .locator('#comics-list .card .meta p')
      .allTextContents();
    const counts = texts.map((t) => parseInt(t, 10));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  test('URL mise à jour (?min=&max=&sort=) (C7)', async ({ page }) => {
    await page.fill('#filter-min', '2');
    await page.selectOption('#filter-sort', 'pages_desc');
    await page.waitForTimeout(400);

    expect(page.url()).toMatch(/[?&]min=2/);
    expect(page.url()).toMatch(/[?&]sort=pages_desc/);
  });

  test('rechargement URL → filtre restauré', async ({ page }) => {
    await page.fill('#filter-min', '2');
    await page.waitForTimeout(400);

    const url = page.url();
    await page.goto(url);

    await expect(page.locator('#filter-min')).toHaveValue('2');
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
  });

  test('X > Y → inversion silencieuse (C8)', async ({ page }) => {
    await page.fill('#filter-min', '10');
    await page.fill('#filter-max', '2');
    await page.waitForTimeout(400);

    // Équivalent à [2,10] → comics_a (3 pages)
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
    await expect(page.locator('#comics-list .card').first()).toContainText(
      'comics_a'
    );
  });

  test('changement d\'onglet → reset du filtre (C9)', async ({ page }) => {
    await page.fill('#filter-min', '5');
    await page.waitForTimeout(400);
    // Aucun comics ne dépasse 5 pages → message
    await expect(page.locator('#no-results')).toBeVisible();

    await page.click('[role="tab"][data-tab="img"]');
    await page.waitForTimeout(100);

    await expect(page.locator('#filter-min')).toHaveValue('0');
    await expect(page.locator('#filter-max')).toHaveValue('');
    await expect(page.locator('#filter-sort')).toHaveValue('alpha');
  });

  test('X minimum forcé à 0 (C5)', async ({ page }) => {
    await page.fill('#filter-min', '-5');
    await page.waitForTimeout(400);

    const count = await page.locator('#comics-list .card').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('bouton Reset → tout est réinitialisé', async ({ page }) => {
    await page.fill('#filter-min', '2');
    await page.selectOption('#filter-sort', 'pages_desc');
    await page.waitForTimeout(400);

    await page.click('#filter-reset');
    await page.waitForTimeout(100);

    await expect(page.locator('#filter-min')).toHaveValue('0');
    await expect(page.locator('#filter-max')).toHaveValue('');
    await expect(page.locator('#filter-sort')).toHaveValue('alpha');
  });
});