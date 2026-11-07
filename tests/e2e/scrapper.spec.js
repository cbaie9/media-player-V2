'use strict';

const { test, expect } = require('@playwright/test');

const ADMIN = { username: 'admin', password: 'admin_pw' };
const READER = { username: 'reader', password: 'reader_pw' };

async function login(page, creds) {
  await page.goto('/login');
  await page.fill('input[name="username"]', creds.username);
  await page.fill('input[name="password"]', creds.password);
  await Promise.all([
    page.waitForURL('/'),
    page.click('button[type="submit"]'),
  ]);
}

async function openScrapper(page) {
  await page.goto('/scrapper');
  await page.waitForSelector('#scrapper-form', { state: 'visible' });
}

/**
 * Attend que le <select> des séries soit peuplé (au moins une option
 * sélectionnable).
 */
async function waitForSeriesPopulated(page) {
  await page.waitForFunction(
    () => {
      const sel = document.getElementById('scrapper-series-dest');
      if (!sel || sel.disabled) return false;
      return Array.from(sel.options).some((o) => o.value && !o.disabled);
    },
    { timeout: 5000 },
  );
}

/**
 * Remplit les deux <select> de destination.
 */
async function pickDest(page, { series = 'onepiece', folder = 'comics' } = {}) {
  await waitForSeriesPopulated(page);
  await page.selectOption('#scrapper-series-dest', series);
  await page.selectOption('#scrapper-folder-dest', folder);
}

/**
 * Remplit les 3 champs et soumet.
 */
async function submitRun(
  page,
  input = 'ok',
  { series = 'onepiece', folder = 'comics' } = {},
) {
  await pickDest(page, { series, folder });
  await page.fill('#scrapper-input', input);
  await page.click('#scrapper-submit');
}

test.describe('Scrapper V1.5 → V1.6', () => {
  test('admin voit le lien "Scrapper" dans la nav', async ({ page }) => {
    await login(page, ADMIN);
    const link = page.locator('#nav-scrapper');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/scrapper');
  });

  test('reader ne voit PAS le lien "Scrapper"', async ({ page }) => {
    await login(page, READER);
    const link = page.locator('#nav-scrapper');
    await expect(link).toBeHidden();
  });

  // ----- V1.6 : sélecteurs destination -----

  test('les <select> sont peuplés au chargement', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await waitForSeriesPopulated(page);

    // Le select série contient au moins une option non-placeholder
    const seriesCount = await page
      .locator('#scrapper-series-dest option:not([disabled])')
      .count();
    expect(seriesCount).toBeGreaterThan(0);

    // Le select folder contient exactement les 4 valeurs
    const folderValues = await page
      .locator('#scrapper-folder-dest option')
      .evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
    expect(folderValues).toEqual([
      'comics',
      'comics_admin',
      'img',
      'img_admin',
    ]);
  });

  test('submit disabled tant que les 3 champs ne sont pas remplis', async ({
    page,
  }) => {
    await login(page, ADMIN);
    await openScrapper(page);
    await waitForSeriesPopulated(page);

    // Initialement : rien rempli → disabled
    await expect(page.locator('#scrapper-submit')).toBeDisabled();

    // Série seule → toujours disabled
    await page.selectOption('#scrapper-series-dest', 'onepiece');
    await expect(page.locator('#scrapper-submit')).toBeDisabled();

    // Série + folder → toujours disabled (input manquant)
    await page.selectOption('#scrapper-folder-dest', 'comics');
    await expect(page.locator('#scrapper-submit')).toBeDisabled();

    // + input → enabled
    await page.fill('#scrapper-input', 'ok');
    await expect(page.locator('#scrapper-submit')).toBeEnabled();
  });

  test('aperçu destination mis à jour au change', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);
    await waitForSeriesPopulated(page);

    // Initialement "—" (aucune sélection)
    await expect(page.locator('#scrapper-dest-preview-path')).toHaveText('—');

    // Série seule → toujours "—" (aperçu exige les 2 selects)
    await page.selectOption('#scrapper-series-dest', 'onepiece');
    await expect(page.locator('#scrapper-dest-preview-path')).toHaveText('—');

    // Série + folder → chemin complet affiché
    await page.selectOption('#scrapper-folder-dest', 'comics');
    await expect(page.locator('#scrapper-dest-preview-path')).toContainText(
      /onepiece\/comics\/$/,
    );
  });

  // ----- V1.6 : exécution -----

  test('succès complet : 3 segments verts + end "ok"', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await submitRun(page, 'ok');

    await expect(
      page.locator('#scrapper-lines .scrapper-line--meta'),
    ).toContainText(/\[fin\].*ok/, { timeout: 15000 });

    for (const phase of [1, 2, 3]) {
      await expect(
        page.locator(`.scrapper-seg[data-phase="${phase}"]`),
      ).toHaveAttribute('data-status', 'done');
    }
  });

  test('échec phase 2 : segment 2 en rouge', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await submitRun(page, 'fail-phase-2');

    await expect(
      page.locator('.scrapper-seg[data-phase="2"]'),
    ).toHaveAttribute('data-status', 'error', { timeout: 15000 });

    await expect(
      page.locator('#scrapper-lines .scrapper-line--stderr').first(),
    ).toBeVisible();
  });

  test('input + selects désactivés pendant le run, réactivés à la fin', async ({
    page,
  }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await submitRun(page, 'ok');

    await expect(page.locator('#scrapper-input')).toBeDisabled();
    await expect(page.locator('#scrapper-series-dest')).toBeDisabled();
    await expect(page.locator('#scrapper-folder-dest')).toBeDisabled();
    await expect(page.locator('#scrapper-submit')).toBeDisabled();

    await expect(
      page.locator('#scrapper-lines .scrapper-line--meta'),
    ).toContainText(/\[fin\]/, { timeout: 15000 });

    await expect(page.locator('#scrapper-input')).toBeEnabled();
    await expect(page.locator('#scrapper-series-dest')).toBeEnabled();
    await expect(page.locator('#scrapper-folder-dest')).toBeEnabled();
    await expect(page.locator('#scrapper-submit')).toBeEnabled();
  });

  test('crash sans marqueur → phase 1 en rouge (D18)', async ({ page }) => {
    await login(page, ADMIN);
    await openScrapper(page);

    await submitRun(page, 'crash');

    await expect(
      page.locator('.scrapper-seg[data-phase="1"]'),
    ).toHaveAttribute('data-status', 'error', { timeout: 15000 });
  });

  // ----- V1.6 : vérification argv côté serveur -----
  //
  // Le fake_scrapper écrit TOUJOURS une ligne JSONL dans
  //   <os.tmpdir()>/mpv2-scrapper-last-argv.jsonl
  // (et AUSSI dans FAKE_SCRAPPER_ARGV_LOG si défini).
  // Ce test lit ce fichier — pas besoin d'adapter server-fixture.js.
  //
  // ⚠️ Suppose --workers=1 (séquentiel). Si un jour la suite E2E
  //    tourne en parallèle, ajouter test.describe.serial() ici.

  test('argv du script contient le dossier de destination', async ({ page }) => {
    const os = require('node:os');
    const pathMod = require('node:path');
    const fs = require('node:fs');

    const logPath =
      process.env.FAKE_SCRAPPER_ARGV_LOG ||
      pathMod.join(os.tmpdir(), 'mpv2-scrapper-last-argv.jsonl');

    // Vider le log avant le run pour ne lire que cette exécution
    try {
      fs.writeFileSync(logPath, '', 'utf8');
    } catch {
      /* ignore */
    }

    await login(page, ADMIN);
    await openScrapper(page);

    await submitRun(page, 'ok', { series: 'onepiece', folder: 'comics' });

    await expect(
      page.locator('#scrapper-lines .scrapper-line--meta'),
    ).toContainText(/\[fin\]/, { timeout: 15000 });

    const raw = fs.readFileSync(logPath, 'utf8').trim();
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.input).toBe('ok');
    expect(entry.dest).toMatch(/[/\\]onepiece[/\\]comics$/);
  });
});