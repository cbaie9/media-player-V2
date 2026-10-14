'use strict';

const { test, expect } = require('@playwright/test');
const { login, waitForSeries, waitForRole } = require('./helpers');

/**
 * V1.2 — Tests de restriction d'accès aux dossiers `_admin` et aux
 * séries admin-only.
 *
 * Fixtures (server-fixture.js) :
 *   onepiece/       comics/, comics_admin/, img/, img_admin/  (non-admin)
 *   naruto/         comics/, comics_admin/                    (non-admin)
 *   admin_series/   comics_admin/, img_admin/                 (admin-only)
 */

/**
 * V1.2 — Attend que la grille comics soit remplie (au moins 1 carte).
 * Utilisé après un goto pour éviter de compter avant le rendu.
 */
async function waitForComicsList(page) {
  await page.waitForSelector('#comics-list .card', { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// 1. Listes de séries
// ---------------------------------------------------------------------------

test.describe('Séries — visibilité par rôle', () => {
  test('reader : admin_series masquée, onepiece et naruto visibles', async ({
    page,
  }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);

    const names = await page
      .locator('#series-list .card h2')
      .allTextContents();

    // Le <h2> peut contenir "nom + 🔒" → on utilise startsWith
    const hasName = (n) => names.some((t) => t.startsWith(n));
    expect(hasName('onepiece')).toBe(true);
    expect(hasName('naruto')).toBe(true);
    expect(hasName('admin_series')).toBe(false);
  });

  test('admin : admin_series visible', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);

    const names = await page
      .locator('#series-list .card h2')
      .allTextContents();

    const hasName = (n) => names.some((t) => t.startsWith(n));
    expect(hasName('admin_series')).toBe(true);
    expect(hasName('onepiece')).toBe(true);
    expect(hasName('naruto')).toBe(true);
  });

  test('admin : badge 🔒 affiché sur la carte admin_series uniquement', async ({
    page,
  }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await waitForRole(page);

    // Carte admin_series contient un 🔒
    const adminCard = page.locator('.card', { hasText: 'admin_series' });
    await expect(adminCard.locator('.lock-badge')).toBeVisible();

    // Carte onepiece n'en contient pas
    const onepieceCard = page.locator('.card', { hasText: 'onepiece' });
    await expect(onepieceCard.locator('.lock-badge')).toHaveCount(0);
  });

  test('reader : aucun 🔒 visible (même sur ses propres séries)', async ({
    page,
  }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await waitForRole(page);

    await expect(page.locator('#series-list .lock-badge')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Page Série — onglets et badges
// ---------------------------------------------------------------------------

test.describe('Page Série — onglets et badges', () => {
  test('reader sur onepiece : pas de 🔒 dans la grille comics', async ({
    page,
  }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await waitForComicsList(page);
    await waitForRole(page);

    await expect(page.locator('#comics-list .lock-badge')).toHaveCount(0);
  });

  test('admin sur onepiece : 🔒 uniquement sur secret_a', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await waitForComicsList(page);
    await waitForRole(page);

    // secret_a a un 🔒
    const secretCard = page.locator('.card', { hasText: 'secret_a' });
    await expect(secretCard.locator('.lock-badge')).toBeVisible();

    // comics_a n'en a pas
    const comicsACard = page.locator('.card', { hasText: 'comics_a' });
    await expect(comicsACard.locator('.lock-badge')).toHaveCount(0);
  });

  test('admin : onepiece affiche 4 comics (3 normaux + 1 admin)', async ({
    page,
  }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await waitForComicsList(page);

    // comics_a, comics_b, comics_c, secret_a (admin)
    // secret_a est un comics avec 2 pages (0001 + 0002)
    const count = await page.locator('#comics-list .card').count();
    expect(count).toBe(4);
  });

  test('reader : onepiece affiche 3 comics uniquement', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/serie/onepiece');
    await waitForComicsList(page);

    const count = await page.locator('#comics-list .card').count();
    expect(count).toBe(3); // a, b, c
  });

  test('admin_series en reader → 404 affiché', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/serie/admin_series');

    // L'API renvoie 404 → message "introuvable"
    await expect(page.locator('#comics-list')).toContainText(
      /introuvable|vide/i
    );
  });

  test('admin_series en admin → onglets comics + images visibles', async ({
  page,
}) => {
  await login(page, 'admin', 'admin_pw');
  await waitForSeries(page);
  await page.goto('/serie/admin_series');
  await waitForComicsList(page);
  await waitForRole(page);

  // L'onglet Comics est sélectionné par défaut
  await expect(
    page.locator('[role="tab"][data-tab="comics"]')
  ).toHaveAttribute('aria-selected', 'true');


  const count = await page.locator('#comics-list .card').count();
  expect(count).toBe(2);

  await expect(page.locator('#comics-list .lock-badge')).toHaveCount(2);
});

  test('admin_series en admin : onglet Images accessible', async ({
    page,
  }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await page.goto('/serie/admin_series?tab=img');
    await waitForComicsList(page);
    await waitForRole(page);

    await expect(
      page.locator('[role="tab"][data-tab="img"]')
    ).toHaveAttribute('aria-selected', 'true');

    const count = await page.locator('#comics-list .card').count();
    expect(count).toBe(1); // admin_only_img
  });
});

// ---------------------------------------------------------------------------
// 3. Accès direct au lecteur
// ---------------------------------------------------------------------------

test.describe('Lecteur — accès direct', () => {
  test('reader sur comics_admin → "introuvable"', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/reader/onepiece/comics_admin/secret_a');

    await expect(page.locator('#page-container')).toContainText(
      /introuvable/i
    );
  });

  test('admin sur comics_admin → lecture OK', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await page.goto('/reader/onepiece/comics_admin/secret_a');

    await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 2');
    await expect(page.locator('#page-container img')).toBeVisible();
  });

  test('reader sur img_admin → "introuvable"', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await page.goto('/reader/onepiece/img_admin/secret_img');

    await expect(page.locator('#page-container')).toContainText(
      /introuvable/i
    );
  });

  test('admin sur img_admin → lecture OK', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await page.goto('/reader/onepiece/img_admin/secret_img');

    await expect(page.locator('#page-container img')).toBeVisible();
  });

  test('reader sur /media/* admin → 404', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);

    const res = await page.request.get(
      '/media/onepiece/comics_admin/secret_a-0001.png'
    );
    expect(res.status()).toBe(404);
  });

  test('admin sur /media/* admin → 200', async ({ page }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);

    const res = await page.request.get(
      '/media/onepiece/comics_admin/secret_a-0001.png'
    );
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. Suggestions cross-dossier
// ---------------------------------------------------------------------------

test.describe('Suggestions cross-dossier', () => {
  async function openEndOverlay(page, serie, folder, name) {
    await page.goto(`/reader/${serie}/${folder}/${name}`);
    await expect(
      page.locator('#page-container img, #page-container video')
    ).toBeVisible();

    // Aller à la dernière page : on clique plusieurs fois sur Suivant
    // jusqu'à ce que l'overlay apparaisse
    for (let i = 0; i < 20; i++) {
      const visible = await page.locator('#end-overlay').isVisible();
      if (visible) break;
      await page.click('#next');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#end-overlay')).toBeVisible();
  }

  test('reader : suggestions ne contiennent jamais de 🔒', async ({ page }) => {
    await login(page, 'reader', 'reader_pw');
    await waitForSeries(page);
    await waitForRole(page);

    await openEndOverlay(page, 'onepiece', 'comics', 'comics_a');
    await expect(
      page.locator('#suggestions .card:not(.card-empty)').first()
    ).toBeVisible();

    const locks = await page
      .locator('#suggestions .lock-badge')
      .count();
    expect(locks).toBe(0);
  });

  test('admin : suggestions cross comics ↔ comics_admin avec 🔒', async ({
    page,
  }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await waitForRole(page);

    await openEndOverlay(page, 'onepiece', 'comics', 'comics_a');
    await expect(
      page.locator('#suggestions .card:not(.card-empty)').first()
    ).toBeVisible();

    // En admin sur onepiece/comics/comics_a :
    //   pool = comics_b + comics_c + secret_a = 3 candidats
    //   (comics_a est exclu, secret_img n'est pas dans la base comics)
    const realCount = await page
      .locator('#suggestions .card:not(.card-empty)')
      .count();
    expect(realCount).toBe(3);

    // secret_a doit avoir un 🔒
    const secret = page.locator('#suggestions .card', { hasText: 'secret_a' });
    await expect(secret.locator('.lock-badge')).toBeVisible();
  });

  test('admin : suggestions ne traversent pas comics ↔ img', async ({
    page,
  }) => {
    await login(page, 'admin', 'admin_pw');
    await waitForSeries(page);
    await waitForRole(page);

    await openEndOverlay(page, 'onepiece', 'comics', 'comics_a');
    await expect(
      page.locator('#suggestions .card:not(.card-empty)').first()
    ).toBeVisible();

    const names = await page
      .locator('#suggestions .card:not(.card-empty) h3')
      .allTextContents();

    // Aucun nom d'img ne doit apparaître
    expect(names.some((n) => n.includes('cover_a'))).toBe(false);
    expect(names.some((n) => n.includes('secret_img'))).toBe(false);
  });
});
