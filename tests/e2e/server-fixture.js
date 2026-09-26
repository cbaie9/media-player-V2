#!/usr/bin/env node
'use strict';

/**
 * Serveur E2E isolé.
 *
 * - Crée un ROOT_DIR temporaire dans tests/e2e/.tmp-root/
 * - Crée des users.json avec 2 comptes (reader/admin) en bcrypt coût faible
 * - Monte l'app via buildApp()
 * - Écoute sur 127.0.0.1:3100
 *
 * Ce serveur n'utilise PAS config.json / .env du projet : tout est injecté
 * en mémoire pour garantir l'isolation des tests E2E.
 */

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');

const { Store } = require('../../src/store');
const { Logger } = require('../../src/logger');
const { buildAuthRouter, buildSessionOptions } = require('../../src/auth');
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

const PORT = 3100;
const SECRET = 'e2e_secret_'.repeat(8);

// ---------------------------------------------------------------------------
// Fixtures : crée une petite médiathèque de test
// ---------------------------------------------------------------------------

function setupRoot() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  const files = [
    // onepiece / comics : comics_a (3 pages), comics_b (1 page), comics_c
    'onepiece/comics/comics_a-0001.png',
    'onepiece/comics/comics_a-0002.png',
    'onepiece/comics/comics_a-0003.png',
    'onepiece/comics/comics_b-0001.png',
    'onepiece/comics/comics_c-0001.png',
    // onepiece / img
    'onepiece/img/cover_a-0001.png',
    // naruto / comics
    'naruto/comics/chap01-0001.png',
  ];

  // PNG minimal 1x1 valide (pour que <img> s'affiche)
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  for (const rel of files) {
    const abs = path.join(ROOT_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, PNG_1x1);
  }
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

  // Statique (CSS/JS)
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // API + Media
  app.use('/api', buildApiRouter({ store, logger }));
  app.use('/media', buildMediaRouter({ rootDir: ROOT_DIR, logger }));

  // Pages protégées
  const { requireAuth } = require('../../src/auth');
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