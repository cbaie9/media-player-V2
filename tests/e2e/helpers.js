'use strict';

/**
 * Log un utilisateur via le formulaire de login.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 * @param {string} password
 */
async function login(page, username = 'reader', password = 'reader_pw') {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL('/'),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * Attend que la liste des séries soit chargée.
 */
async function waitForSeries(page) {
  await page.waitForSelector('#series-list .card', { timeout: 5000 });
}

/**
 * V1.2 — Attend que le rôle soit résolu côté client (window.__meReady).
 * Utile dans les specs qui vérifient des badges 🔒 : sans ça, il y a une
 * course entre header.js et le script de page.
 */
async function waitForRole(page) {
  await page.waitForFunction(
    () => !!window.api && window.api.getRole() !== null,
    { timeout: 5000 }
  );
}

module.exports = { login, waitForSeries, waitForRole };