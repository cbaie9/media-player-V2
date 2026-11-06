#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

const { Store } = require('../../src/store');
const { Logger } = require('../../src/logger');
const { buildAuthRouter, buildSessionOptions, requireAuth } = require('../../src/auth');
const { buildApiRouter } = require('../../src/routes/api');
const { buildMediaRouter } = require('../../src/routes/media');
const { buildScrapperRouter } = require('../../src/scrapper');
const { LoginRateLimiter } = require('../../src/security');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const PROTECTED_DIR = path.join(PROJECT_ROOT, 'protected');
const TMP_DIR = path.join(__dirname, '.tmp-root');
const ROOT_DIR = path.join(TMP_DIR, 'media');
const CACHE_FILE = path.join(TMP_DIR, 'cache', 'scan.json');
const WARN_FILE = path.join(TMP_DIR, 'logs', 'scan-warnings.log');
const APP_LOG = path.join(TMP_DIR, 'logs', 'app.jsonl');

const SAMPLE_VIDEO = path.join(
  PROJECT_ROOT, 'tests', 'fixtures', 'assets', 'sample.mp4'
);

const FAKE_SCRAPPER = path.join(
  PROJECT_ROOT, 'tests', 'fixtures', 'fake_scrapper.js'
);

const PORT = 3100;
const SECRET = 'e2e_secret_'.repeat(8);

// ---------------------------------------------------------------------------
// Fixtures V1.2 + V1.4 (inchangé)
// ---------------------------------------------------------------------------

function writeVideo(targetAbs) {
  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  if (fs.existsSync(SAMPLE_VIDEO)) {
    fs.copyFileSync(SAMPLE_VIDEO, targetAbs);
    return 'real';
  }
  fs.writeFileSync(targetAbs, 'FAKE_MP4_CONTENT\n', 'utf8');
  return 'fake';
}

function setupRoot() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const w = (rel) => {
    const abs = path.join(ROOT_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, PNG_1x1);
  };

  // --- onepiece (V1.1 + V1.2, INCHANGÉ) ----------------------------------
  w('onepiece/comics/comics_a-0001.png');
  w('onepiece/comics/comics_a-0002.png');
  w('onepiece/comics/comics_a-0003.png');
  w('onepiece/comics/comics_b-0001.png');
  w('onepiece/comics/comics_c-0001.png');
  w('onepiece/img/cover_a-0001.png');
  w('onepiece/comics_admin/secret_a-0001.png');
  w('onepiece/comics_admin/secret_a-0002.png');
  w('onepiece/img_admin/secret_img-0001.png');

  // --- naruto (V1.1 + V1.2, INCHANGÉ) ------------------------------------
  w('naruto/comics/chap01-0001.png');
  const realFlag = writeVideo(
    path.join(ROOT_DIR, 'naruto/comics/video_a-0001.mp4')
  );
  fs.mkdirSync(path.join(ROOT_DIR, 'naruto/comics'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT_DIR, 'naruto/comics/corrupt_a-0001.mp4'),
    'CORRUPTED_NOT_A_VIDEO\n',
    'utf8'
  );
  w('naruto/comics_admin/secret_chap-0001.png');

  // --- admin_series (V1.2, INCHANGÉ) -------------------------------------
  w('admin_series/comics_admin/private_a-0001.png');
  w('admin_series/comics_admin/private_a-0002.png');
  w('admin_series/comics_admin/private_b-0001.png');
  w('admin_series/img_admin/private_img-0001.png');

  // --- manwa_fixtures (V1.4.3 — SÉRIE DÉDIÉE) ----------------------------
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(4, '0');
    w(`manwa_fixtures/comics/manwa_many-${num}.png`);
  }
  w('manwa_fixtures/comics/manwa_single-0001.png');
  writeVideo(
    path.join(ROOT_DIR, 'manwa_fixtures/comics/manwa_video_only-0001.mp4')
  );
  w('manwa_fixtures/comics/manwa_mix-0001.png');
  w('manwa_fixtures/comics/manwa_mix-0002.png');
  w('manwa_fixtures/comics/manwa_mix-0003.png');
  writeVideo(
    path.join(ROOT_DIR, 'manwa_fixtures/comics/manwa_mix-0004.mp4')
  );

  console.log(`[e2e] video fixture: ${realFlag}`);
}

// ---------------------------------------------------------------------------
// Config Scrapper de test (V1.5)
//
// On construit un bloc `python_module` inline qui utilise le binaire
// node courant (`process.execPath`) comme interpréteur → pas de python
// requis sur la CI. Le "script" est `tests/fixtures/fake_scrapper.js`.
// ---------------------------------------------------------------------------

function buildScrapperConfig() {
  return {
    python_module: {
      script_path: FAKE_SCRAPPER,
      python_executable: process.execPath,
      cwd: path.dirname(FAKE_SCRAPPER),
      timeout_seconds: 60,
      max_concurrent_per_session: 1,
      max_concurrent_global: 3,
      allowed_roles: ['admin'],
      rate_limit: { windowMinutes: 5, maxAttempts: 50 },
    },
    python_module_disabled_reason: null,
  };
}

// ---------------------------------------------------------------------------
// App Express
// ---------------------------------------------------------------------------

async function buildE2EApp() {
  setupRoot();

  const logger = new Logger({ filePath: APP_LOG });

  const store = new Store({
    rootDir: ROOT_DIR,
    cacheFile: CACHE_FILE,
    warningsFile: WARN_FILE,
    logger,
  });
  store.rescan();

  const users = {
    reader: { password_hash: await bcrypt.hash('reader_pw', 4) },
    admin: { password_hash: await bcrypt.hash('admin_pw', 4) },
  };

  const app = express();
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    session(
      buildSessionOptions({
        sessionSecret: SECRET,
        sessionMaxAgeHours: 24,
        https: false,
      })
    )
  );

  const rateLimiter = new LoginRateLimiter({ maxAttempts: 5 });
  app.use(buildAuthRouter({ users, rateLimiter }));

  // ---- Scrapper (V1.5) ----
  const scrapperConfig = buildScrapperConfig();
  app.use(buildScrapperRouter({ config: scrapperConfig }));

  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use('/api', buildApiRouter({ store, logger }));
  app.use('/media', buildMediaRouter({ rootDir: ROOT_DIR, logger }));

  app.get('/', requireAuth(), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'series.html'));
  });
  app.get('/serie/:serie', requireAuth(), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'serie.html'));
  });
  app.get('/reader/:serie/:folder/:name', requireAuth(), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'reader.html'));
  });

  // Page Scrapper : protégée. On cherche d'abord dans protected/,
  // puis dans public/ (compat avec ton montage actuel).
  app.get('/scrapper', requireAuth(), (req, res) => {
    const inProtected = path.join(PROTECTED_DIR, 'scrapper.html');
    const inPublic = path.join(PUBLIC_DIR, 'scrapper.html');
    if (fs.existsSync(inProtected)) return res.sendFile(inProtected);
    return res.sendFile(inPublic);
  });

  app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}

buildE2EApp()
  .then((app) => {
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[e2e] server listening on http://127.0.0.1:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[e2e] failed to start:', err);
    process.exit(1);
  });