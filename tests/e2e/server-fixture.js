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
// Fixtures
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

  // Images : onepiece et naruto inchangés (compat V2).
  // ⚠️ comics_a-0003.png = IMAGE (le test end-of-comics clique sur la
  // dernière page → doit naviguer, pas rester bloqué sur une vidéo).
  const images = [
    // onepiece : 3 comics · 1 img (V2 d'origine)
    'onepiece/comics/comics_a-0001.png',
    'onepiece/comics/comics_a-0002.png',
    'onepiece/comics/comics_a-0003.png',
    'onepiece/comics/comics_b-0001.png',
    'onepiece/comics/comics_c-0001.png',
    'onepiece/img/cover_a-0001.png',
    // naruto : chap01 + vidéos ajoutées pour tests V1.1
    'naruto/comics/chap01-0001.png',
  ];

  for (const rel of images) {
    const abs = path.join(ROOT_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, PNG_1x1);
  }

  // Vidéo réelle (ou fake si sample.mp4 absent) — dans naruto
  const realFlag = writeVideo(
    path.join(ROOT_DIR, 'naruto/comics/video_a-0001.mp4')
  );

  // Vidéo toujours corrompue (test fallback B11) — dans naruto
  fs.mkdirSync(path.join(ROOT_DIR, 'naruto/comics'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT_DIR, 'naruto/comics/corrupt_a-0001.mp4'),
    'CORRUPTED_NOT_A_VIDEO\n',
    'utf8'
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