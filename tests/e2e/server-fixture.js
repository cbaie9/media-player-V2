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
const { LoginRateLimiter } = require('../../src/security');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const TMP_DIR = path.join(__dirname, '.tmp-root');
const ROOT_DIR = path.join(TMP_DIR, 'media');
const CACHE_FILE = path.join(TMP_DIR, 'cache', 'scan.json');
const WARN_FILE = path.join(TMP_DIR, 'logs', 'scan-warnings.log');
const APP_LOG = path.join(TMP_DIR, 'logs', 'app.jsonl');

const SAMPLE_VIDEO = path.join(
  PROJECT_ROOT, 'tests', 'fixtures', 'assets', 'sample.mp4'
);

const PORT = 3100;
const SECRET = 'e2e_secret_'.repeat(8);

// ---------------------------------------------------------------------------
// Fixtures V1.2 + V1.4
//
// Arborescence :
//
//   onepiece/       comics/ (comics_a,b,c), comics_admin/, img/, img_admin/
//   naruto/         comics/ (chap01, video_a, corrupt_a), comics_admin/
//   admin_series/   comics_admin/, img_admin/  (admin-only)
//   manwa_fixtures/ (V1.4.3) comics/ — 4 comics dédiés au lecteur Manwa :
//                     - manwa_many       : 20 images
//                     - manwa_single     : 1 image
//                     - manwa_video_only : 1 vidéo
//                     - manwa_mix        : 3 images + 1 vidéo
//
// V1.4.3 : les fixtures Manwa sont dans une SÉRIE DÉDIÉE `manwa_fixtures/`.
// Raison : toute modification d'onepiece ou naruto casse un test existant
// (admin-lock, filter, series, search, end-of-comics...). Une série
// dédiée isole complètement les fixtures Manwa — seul series.spec.js est
// ajusté (toHaveCount 2 → 3).
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