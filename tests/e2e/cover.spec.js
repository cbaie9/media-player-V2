'use strict';

const { test, expect, request: requestAPI } = require('@playwright/test');
const { login, waitForSeries } = require('./helpers');

/**
 * V1.5.3 — Tests de la fonctionnalité « cover de série ».
 *
 * Couvre :
 *   1. Affichage front-end (page /)
 *      a. série avec cover valide  → <img src="/media/<serie>/cover">
 *                                    + image réellement décodée (naturalWidth > 0)
 *      b. série sans cover         → <img src="data:image/svg+xml..."> (placeholder)
 *      c. série avec cover cassée  → onerror → bascule sur placeholder
 *   2. Endpoint GET /media/:serie/cover
 *      a. 200 + Content-Type image/png quand la cover existe
 *      b. 404 + { error: 'file_not_found' } quand la série n'a pas de cover
 *      c. 404 quand la série n'existe pas
 *      d. 404 quand la série est admin-only et le rôle reader
 *      e. 200 quand la série est admin-only et le rôle admin
 *      f. support du header Range (206 Partial Content)
 *
 * Fixtures correspondantes dans tests/e2e/server-fixture.js :
 *   - onepiece/cover.png            (PNG valide)
 *   - naruto/cover.png              (bytes invalides → onerror)
 *   - admin_series/cover.png        (PNG valide, série admin-only)
 *   - manwa_fixtures                (pas de cover)
 *   - formats_v152                  (pas de cover)
 */

const PLACEHOLDER_RE = /^data:image\/svg\+xml/;

// ---------------------------------------------------------------------------
// 1. Affichage front-end
// ---------------------------------------------------------------------------

test.describe('Cover — affichage front-end', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
  });

  test('série avec cover valide : src = /media/<serie>/cover, image décodée',
    async ({ page }) => {
      const img = page
        .locator('.card', { hasText: 'onepiece' })
        .locator('img.thumb');

      await expect(img).toHaveAttribute(
        'src',
        /\/media\/onepiece\/cover$/
      );

      // L'image est réellement chargée et décodée.
      await expect
        .poll(
          async () => img.evaluate((el) => el.naturalWidth),
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
    }
  );

  test('série sans cover : src = placeholder data-URI',
    async ({ page }) => {
      const img = page
        .locator('.card', { hasText: 'manwa_fixtures' })
        .locator('img.thumb');

      await expect(img).toHaveAttribute('src', PLACEHOLDER_RE);
    }
  );

  test('cover cassée : onerror bascule sur le placeholder',
    async ({ page }) => {
      const img = page
        .locator('.card', { hasText: 'naruto' })
        .locator('img.thumb');

      // Le src initial pointe vers /media/naruto/cover (le fichier
      // existe sur disque mais n'est pas un PNG valide). Le browser
      // échoue au décodage → event error → handler `once` bascule
      // sur le placeholder. Playwright retente jusqu'au timeout.
      await expect(img).toHaveAttribute('src', PLACEHOLDER_RE, {
        timeout: 5000,
      });

      // Vérifie aussi que l'image finale est bien « chargée » (l'SVG
      // placeholder a une largeur intrinsèque de 200px).
      await expect
        .poll(
          async () => img.evaluate((el) => el.naturalWidth),
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Endpoint GET /media/:serie/cover
// ---------------------------------------------------------------------------

test.describe('GET /media/:serie/cover', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForSeries(page);
  });

  test('200 + Content-Type image/png quand la cover existe',
    async ({ page }) => {
      const res = await page.request.get('/media/onepiece/cover');
      expect(res.status()).toBe(200);

      const ct = res.headers()['content-type'] || '';
      expect(ct).toMatch(/^image\/png/);

      const body = await res.body();
      expect(body.length).toBeGreaterThan(0);

      // Signature PNG : 0x89 0x50 0x4E 0x47 ('\x89PNG')
      expect(body[0]).toBe(0x89);
      expect(body[1]).toBe(0x50); // 'P'
      expect(body[2]).toBe(0x4e); // 'N'
      expect(body[3]).toBe(0x47); // 'G'
    }
  );

  test('404 + { error: "file_not_found" } quand la série n\'a pas de cover',
    async ({ page }) => {
      const res = await page.request.get('/media/manwa_fixtures/cover');
      expect(res.status()).toBe(404);

      const body = await res.json();
      expect(body.error).toBe('file_not_found');
    }
  );

  test('404 quand la série n\'existe pas',
    async ({ page }) => {
      const res = await page.request.get('/media/serie_inexistante/cover');
      expect(res.status()).toBe(404);
    }
  );

  test('404 quand la série est admin-only et le rôle reader',
    async ({ page }) => {
      // admin_series est admin-only : un reader ne doit pas pouvoir
      // récupérer sa cover, même si le fichier existe sur disque.
      // (La cover EST bien détectée dans le store — sinon le 404
      // proviendrait de l'absence de cover, pas de la protection.)
      const res = await page.request.get('/media/admin_series/cover');
      expect(res.status()).toBe(404);

      const body = await res.json();
      expect(body.error).toBe('file_not_found');
    }
  );

  test('200 quand la série est admin-only et le rôle admin',
    async ({ page, baseURL }) => {
      // Contexte requête isolé pour ne pas polluer la session reader
      // du `page` (déjà loggué par le beforeEach).
      const ctx = await requestAPI.newContext({ baseURL });
      try {
        const loginRes = await ctx.post('/login', {
          form: {
            username: 'admin',
            password: 'admin_pw',
          },
          maxRedirects: 0,
        });
        // buildAuthRouter répond en général 302 sur succès ; on accepte
        // 2xx et 3xx pour être robuste au contrat exact.
        expect(loginRes.status()).toBeLessThan(400);

        const res = await ctx.get('/media/admin_series/cover');
        expect(res.status()).toBe(200);

        const ct = res.headers()['content-type'] || '';
        expect(ct).toMatch(/^image\/png/);
      } finally {
        await ctx.dispose();
      }
    }
  );

  test('supporte Range: bytes=0-4 → 206 Partial Content',
    async ({ page }) => {
      const res = await page.request.get('/media/onepiece/cover', {
        headers: { Range: 'bytes=0-4' },
      });
      expect(res.status()).toBe(206);

      const cr = res.headers()['content-range'] || '';
      expect(cr).toMatch(/^bytes 0-4\/\d+$/);

      const cl = res.headers()['content-length'];
      expect(cl).toBe('5');

      const body = await res.body();
      expect(body.length).toBe(5);
      // Doit commencer par la signature PNG
      expect(body[0]).toBe(0x89);
    }
  );

  test('Cache-Control: private, max-age=3600',
    async ({ page }) => {
      const res = await page.request.get('/media/onepiece/cover');
      expect(res.status()).toBe(200);
      const cc = res.headers()['cache-control'] || '';
      expect(cc).toContain('private');
      expect(cc).toContain('max-age=3600');
    }
  );
});