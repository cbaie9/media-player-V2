'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

test.describe('Liste des séries', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
  });

  test('affiche onepiece et naruto', async ({ page }) => {
    const items = page.locator('#series-list .card h2');
    await expect(items).toHaveCount(2);
    const texts = await items.allTextContents();
    expect(texts).toContain('onepiece');
    expect(texts).toContain('naruto');
  });

  test('affiche comicsCount et imgCount', async ({ page }) => {
    const onepieceCard = page.locator('.card', { hasText: 'onepiece' });
    await expect(onepieceCard.locator('.meta p')).toContainText('3 comics');
    await expect(onepieceCard.locator('.meta p')).toContainText('1 images');
  });

  test('clic sur onepiece → page série', async ({ page }) => {
    await page.locator('.card', { hasText: 'onepiece' }).click();
    await expect(page).toHaveURL(/\/serie\/onepiece$/);
    await expect(page.locator('#serie-title')).toHaveText('onepiece');
  });
});