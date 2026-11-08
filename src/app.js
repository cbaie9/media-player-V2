'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');

const {
  loadUsers,
  buildSessionOptions,
  buildAuthRouter,
  requireAuth,
} = require('./auth');
const { buildApiRouter } = require('./routes/api');
const { buildMediaRouter } = require('./routes/media');
const { buildScrapperRouter } = require('./scrapper');
const { LoginRateLimiter } = require('./security');
const { mimeGroups } = require('./utils/extensions');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveFromProject(p) {
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

function buildApp({ config, sessionSecret, store, logger }) {
  const app = express();

  // --- V1.5.2 / V1.5.3 — Types MIME des extensions supportées -----------
  // Doit être fait AVANT express.static(public) et buildMediaRouter.
  // V1.5.3 : la liste est dérivée de `utils/extensions.js` (une ligne
  // pour ajouter un nouveau format).
  express.static.mime.define(mimeGroups());

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    session(
      buildSessionOptions({
        sessionSecret,
        sessionMaxAgeHours: config.SESSION_MAX_AGE_HOURS,
        https: !!config.HTTPS,
      })
    )
  );

  // --- Auth ----------------------------------------------------------------
  const users = loadUsers(resolveFromProject(config.USERS_FILE));
  const rateLimiter = new LoginRateLimiter({
    windowMs: config.LOGIN_RATE_LIMIT.windowMinutes * 60 * 1000,
    maxAttempts: config.LOGIN_RATE_LIMIT.maxAttempts,
  });

  app.use(
    buildAuthRouter({
      users,
      rateLimiter,
      onLoginSuccess: (username, ip) =>
        logger && logger.info('login_success', { username, ip }),
      onLoginFailure: (username, ip) =>
        logger && logger.warn('login_failure', { username, ip }),
      onRateLimited: (ip) =>
        logger && logger.warn('login_rate_limited', { ip }),
    })
  );

  // --- Scrapper (V1.5) -----------------------------------------------------
  app.use(buildScrapperRouter({ config, store }));

  // --- Fichiers statiques --------------------------------------------------
  app.use(
    express.static(path.join(PROJECT_ROOT, 'public'), {
      index: false,
    })
  );

  // --- Routes protégées ---------------------------------------------------
  app.use('/api', buildApiRouter({ store, logger }));
  app.use(
    '/media',
    buildMediaRouter({
      rootDir: config.ROOT_DIR,
      logger,
    })
  );

  // --- Pages protégées ----------------------------------------------------
  app.get('/', requireAuth(), (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'series.html'));
  });

  app.get('/serie/:serie', requireAuth(), (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'serie.html'));
  });

  app.get('/reader/:serie/:folder/:name', requireAuth(), (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'reader.html'));
  });

  app.get('/scrapper', requireAuth(), (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'protected', 'scrapper.html'));
  });

  app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/');
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'index.html'));
  });

  return app;
}

module.exports = { buildApp, resolveFromProject };