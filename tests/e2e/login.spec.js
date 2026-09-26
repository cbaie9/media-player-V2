'use strict';

const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Login', () => {
  test('accès racine sans session → redirige vers /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('h1')).toHaveText('Media Player V2');
  });

  test('login valide → page séries', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1')).toHaveText('Séries disponibles');
    await expect(page.locator('#series-list .card').first()).toBeVisible();
  });

  test('login invalide → message d\'erreur', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'reader');
    await page.fill('#password', 'mauvais');
    await page.click('button[type="submit"]');

    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toContainText('Identifiants invalides');
  });

  test('déconnexion → retour login', async ({ page }) => {
    await login(page);

    // Déconnexion (bouton dans le topbar)
    await page.click('#logout');
    await expect(page).toHaveURL(/\/login$/);

    // Nouvelle tentative d'accès → refusée
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('accès direct à /api/series sans session → 401', async ({ request }) => {
    const res = await request.get('/api/series');
    expect(res.status()).toBe(401);
  });
});