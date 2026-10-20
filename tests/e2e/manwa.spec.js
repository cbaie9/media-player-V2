'use strict';

const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const BASE = 'http://127.0.0.1:3100';
const SERIE = 'manwa_fixtures';

// Fixtures V1.4.3 : les comics Manwa vivent dans une SÉRIE DÉDIÉE
// (voir tests/e2e/server-fixture.js).
const COMICS_MANY = 'manwa_many';             // 20 pages images
const COMICS_SINGLE = 'manwa_single';         // 1 page image
const COMICS_VIDEO_ONLY = 'manwa_video_only'; // 1 page vidéo
const COMICS_MIX = 'manwa_mix';               // 3 images + 1 vidéo

async function gotoReader(page, comics, mode) {
  const context = page.context();

  if (mode) {
    await context.addCookies([{
      name: 'reader_mode',
      value: mode,
      url: BASE,
      sameSite: 'Lax',
    }]);
  } else {
    await context.clearCookies({ name: 'reader_mode' }).catch(() => {});
  }

  await login(page);
  await page.goto(`/reader/${SERIE}/comics/${comics}`);
  await page.waitForFunction(
    () => window.readerState &&
          window.readerState.pages &&
          window.readerState.pages.length > 0,
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () => window.__manwaReady === true,
    { timeout: 5000 }
  );
}

test.describe('Lecteur Manwa (V1.4)', () => {

  test('1. Toggle Classic → Manwa', async ({ page }) => {
    await gotoReader(page, COMICS_MANY);
    await expect(page.locator('html')).not.toHaveClass(/manwa-mode/);
    await expect(page.locator('#reader-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#reader-toggle')).toBeVisible();

    await page.click('#reader-toggle');

    await expect(page.locator('html')).toHaveClass(/manwa-mode/);
    await expect(page.locator('#reader-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reader-toggle')).toHaveText('Passer en mode Classique');
  });

  test('2. Toggle Manwa → Classic', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');
    await expect(page.locator('html')).toHaveClass(/manwa-mode/);

    await page.click('#reader-toggle');

    await expect(page.locator('html')).not.toHaveClass(/manwa-mode/);
    await expect(page.locator('#reader-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#classic-reader')).toBeVisible();
  });

  test('3. Cookie reader_mode=manwa au chargement (sans flash)', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');
    await expect(page.locator('html')).toHaveClass(/manwa-mode/);
    await expect(page.locator('#reader-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#manwa-list')).toBeVisible();
  });

  test('4. Scroll vertical charge les images à la demande', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');

    const loaded0 = await page.locator('.manwa-item img:not([data-src])').count();
    expect(loaded0).toBeLessThan(20);

    await page.evaluate(() => {
      const li = document.getElementById('page-000014');
      if (li) li.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);

    const loaded1 = await page.locator('.manwa-item img:not([data-src])').count();
    expect(loaded1).toBeGreaterThan(loaded0);
  });

  test('5. Lazy loading : peu d\'images chargées au démarrage', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');

    const total = await page.locator('.manwa-item img').count();
    expect(total).toBe(20);

    const withDataSrc = await page.locator('.manwa-item img[data-src]').count();
    expect(withDataSrc).toBeGreaterThan(10);
  });

  test('6. Scrollspy de fin (manwa_many) → overlay', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');
    await page.evaluate(() => {
      const r = document.getElementById('manwa-reader');
      r.scrollTop = r.scrollHeight;
    });
    await expect(page.locator('#end-overlay')).toBeVisible();
    await expect(page.locator('#end-title')).toHaveText('Fin du comics');
  });

  test('7. Scrollspy (manwa_single) : pas immédiat au toggle', async ({ page }) => {
    await gotoReader(page, COMICS_SINGLE);
    await page.click('#reader-toggle');
    await page.waitForTimeout(500);
    await expect(page.locator('#end-overlay')).toBeHidden();
  });

  test('8. Comics video-only : toggle masqué et classic forcé', async ({ page }) => {
    await gotoReader(page, COMICS_VIDEO_ONLY);
    await expect(page.locator('#reader-toggle')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/manwa-mode/);
    await expect(page.locator('#classic-reader')).toBeVisible();
  });

  test('9. Synchronisation Classic → Manwa', async ({ page }) => {
    await gotoReader(page, COMICS_MANY);

    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-indicator')).toHaveText('Page 5 / 20');

    await page.click('#reader-toggle');
    // Attendre la fin de la fenêtre ctx.syncing (300 ms) + marge
    await page.waitForTimeout(400);

    const idx = await page.evaluate(() => window.readerState.index);
    expect(idx).toBeGreaterThanOrEqual(3);
    expect(idx).toBeLessThanOrEqual(5);

    const inView = await page.evaluate(() => {
      const li = document.getElementById('page-000004');
      if (!li) return false;
      const r = li.getBoundingClientRect();
      return r.top >= -50 && r.top < window.innerHeight;
    });
    expect(inView).toBe(true);
  });

  test('10. Synchronisation Manwa → Classic', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');

    await page.evaluate(() => {
      const li = document.getElementById('page-000009');
      if (li) li.scrollIntoView({ block: 'start' });
    });
    // Attendre le re-check de manwa.js (SYNC_RELEASE_MS + rAF) + settle
    await page.waitForTimeout(500);

    const idxBefore = await page.evaluate(() => window.readerState.index);
    expect(idxBefore).toBeGreaterThanOrEqual(8);

    await page.click('#reader-toggle');

    await expect(page.locator('#classic-reader')).toBeVisible();
    const indicator = await page.locator('#page-indicator').textContent();
    const m = indicator.match(/Page (\d+) \/ 20/);
    expect(m).not.toBeNull();
    const currentPage = parseInt(m[1], 10) - 1;
    expect(Math.abs(currentPage - idxBefore)).toBeLessThanOrEqual(1);
  });

  test('11. Vidéo en Manwa : contrôles présents', async ({ page }) => {
    await gotoReader(page, COMICS_MIX, 'manwa');

    await page.evaluate(() => {
      const li = document.getElementById('page-000003');
      if (li) li.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);

    const video = page.locator('#page-000003 video');
    await expect(video).toBeAttached();
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('preload', 'metadata');
  });

  test('12. Échec de chargement image → placeholder croix', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');

    await page.evaluate(() => {
      const img = document.querySelector('.manwa-item img');
      if (img) {
        img.removeAttribute('data-src');
        img.src = '/__nonexistent__.png';
      }
    });
    await page.waitForTimeout(300);

    const src = await page.locator('.manwa-item img').first().getAttribute('src');
    expect(src).toMatch(/^data:image\/svg/);
    expect(decodeURIComponent(src)).toContain('#ff6b6b');
  });

  test('13. Accessibilité : role, tabindex, alt, aria-live', async ({ page }) => {
    await gotoReader(page, COMICS_MANY, 'manwa');

    await expect(page.locator('#manwa-list')).toHaveAttribute('role', 'list');

    const firstLi = page.locator('.manwa-item').first();
    await expect(firstLi).toHaveAttribute('tabindex', '0');

    const imgAlt = await page.locator('.manwa-item img').first().getAttribute('alt');
    expect(imgAlt).toMatch(/^Page \d+/);

    await expect(page.locator('#manwa-end-announce'))
      .toHaveAttribute('aria-live', 'polite');

    await expect(page.locator('#reader-toggle'))
      .toHaveAttribute('aria-pressed', 'true');
  });

});