'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { login, waitForSeries } = require('./helpers');

const SAMPLE_VIDEO = path.join(
  __dirname, '..', 'fixtures', 'assets', 'sample.mp4'
);
const HAS_REAL_VIDEO = fs.existsSync(SAMPLE_VIDEO);

const SERIE = 'serie_video';
const VIDEO_COMICS = 'video_a';
const CORRUPT_COMICS = 'corrupt_a';

test.describe('Vignettes vidéo (B)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
    await page.goto('/serie/' + SERIE);
    await expect(page.locator('#comics-list .card').first()).toBeVisible();
  });

  test('overlay ▶ présent sur les vignettes vidéo (B13)', async ({ page }) => {
    const videoThumb = page.locator('img.thumb-video').first();
    await expect(videoThumb).toBeVisible();

    const hasOverlay = await videoThumb.evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return style && style.content === '"▶"';
    });
    expect(hasOverlay).toBe(true);
  });

  test('vidéo corrompue → placeholder ▶ (B11)', async ({ page }) => {
    const corruptCard = page.locator('.card', { hasText: CORRUPT_COMICS });
    await expect(corruptCard).toBeVisible();

    await corruptCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);

    const src = await corruptCard.locator('img.thumb').getAttribute('src');
    expect(src).toMatch(/^data:image\/svg\+xml/);

    const state = await corruptCard
      .locator('img.thumb')
      .getAttribute('data-thumb-state');
    expect(state).toBe('failed');
  });

  test('file d\'attente séquentielle (B9, F7)', async ({ page }) => {
    const stats = await page.evaluate(() => {
      return window.thumb && window.thumb.stats
        ? Object.keys(window.thumb.stats).sort()
        : null;
    });
    expect(stats).toEqual(
      expect.arrayContaining(['cached', 'extracted', 'failed', 'pending'])
    );
  });

  test.describe('avec vraie vidéo', () => {
    test.skip(
      !HAS_REAL_VIDEO,
      'sample.mp4 absent — tests nécessitant une vraie vidéo skippés'
    );

    test('vignette extraite affichée (B2, B14)', async ({ page }) => {
      const videoCard = page.locator('.card', { hasText: VIDEO_COMICS });
      await videoCard.scrollIntoViewIfNeeded();

      await page.waitForFunction(
        () =>
          window.thumb &&
          window.thumb.stats &&
          window.thumb.stats.extracted > 0,
        { timeout: 10000 }
      );

      const state = await videoCard
        .locator('img.thumb')
        .getAttribute('data-thumb-state');
      expect(state).toBe('ready');
    });

    test('Cache Storage : 2e affichage → pas de ré-extraction (B3)', async ({
      page,
    }) => {
      const videoCard = page.locator('.card', { hasText: VIDEO_COMICS });
      await videoCard.scrollIntoViewIfNeeded();

      await page.waitForFunction(
        () => window.thumb && window.thumb.stats.extracted > 0,
        { timeout: 10000 }
      );

      const statsAfterFirst = await page.evaluate(() => ({
        extracted: window.thumb.stats.extracted,
        cached: window.thumb.stats.cached,
      }));

      // Navigue ailleurs puis retour
      await page.goto('/serie/onepiece');
      await page.goto('/serie/' + SERIE);
      await videoCard.scrollIntoViewIfNeeded();

      await page.waitForFunction(
        () => window.thumb && window.thumb.stats.cached > 0,
        { timeout: 10000 }
      );

      const statsAfterSecond = await page.evaluate(() => ({
        extracted: window.thumb.stats.extracted,
        cached: window.thumb.stats.cached,
      }));

      expect(statsAfterSecond.extracted).toBe(statsAfterFirst.extracted);
      expect(statsAfterSecond.cached).toBeGreaterThan(statsAfterFirst.cached);
    });
  });
});