'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

test.describe('Page série', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await expect(page.locator('#serie-title')).toHaveText('onepiece');
    await expect(page.locator('#comics-list .card').first()).toBeVisible();
  });

  test('onglet Comics actif par défaut', async ({ page }) => {
    await expect(page.locator('[role="tab"][data-tab="comics"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('#comics-list .card')).toHaveCount(3);
  });

  test('clic onglet Images → affiche les imagesets', async ({ page }) => {
    await page.click('[role="tab"][data-tab="img"]');
    await expect(page.locator('[role="tab"][data-tab="img"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('#comics-list .card')).toHaveCount(1);
  });

  test('clic sur un comics → lecteur', async ({ page }) => {
    await page.locator('.card', { hasText: 'comics_a' }).click();
    await expect(page).toHaveURL(/\/reader\/onepiece\/comics\/comics_a$/);
    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 3');
  });
});