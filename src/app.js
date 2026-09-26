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
const { LoginRateLimiter } = require('./security');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveFromProject(p) {
  return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p);
}

/**
 * Construit l'app Express.
 * @param {object} params
 * @param {object} params.config
 * @param {string} params.sessionSecret
 * @param {import('./store').Store} params.store
 * @param {object} params.logger
 * @returns {import('express').Express}
 */
function buildApp({ config, sessionSecret, store, logger }) {
  const app = express();

  // Derrière un proxy ? (hors V1, mais laisse la porte ouverte)
  // app.set('trust proxy', 1);

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

  // --- Fichiers statiques (login + CSS + JS) -------------------------------
  // Le login (index.html) doit être servi SANS auth.
  app.use(express.static(path.join(PROJECT_ROOT, 'public'), {
    index: false, // on gère l'index nous-mêmes
  }));

  // --- Routes protégées ---------------------------------------------------
  app.use('/api', buildApiRouter({ store, logger }));
  app.use('/media', buildMediaRouter({
    rootDir: config.ROOT_DIR,
    logger,
  }));

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

  // Login : redirige vers / si déjà connecté
  app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/');
    res.sendFile(path.join(PROJECT_ROOT, 'public', 'index.html'));
  });

  return app;
}

module.exports = { buildApp, resolveFromProject };