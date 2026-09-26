'use strict';

const fs = require('node:fs');
const bcrypt = require('bcrypt');
const { LoginRateLimiter } = require('./security');

/**
 * Hash bcrypt factice (coût 12) utilisé pour rendre la vérification
 * "timing-safe" même quand l'utilisateur n'existe pas (cf. §2.1).
 */
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEeO9YzZb0m8wKcWZ0W8k1qjKp5pY7uJ3.G';

/**
 * Charge le fichier users.json.
 * Format attendu (cf. §13.4) :
 *   { "reader": { "password_hash": "$2b$..." }, "admin": { ... } }
 *
 * @param {string} usersFile - Chemin absolu
 * @returns {Record<string, { password_hash: string }>}
 */
function loadUsers(usersFile) {
  const raw = fs.readFileSync(usersFile, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('users.json: structure invalide');
  }
  return parsed;
}

/**
 * Vérifie les identifiants. Toujours timing-safe (§2.1).
 */
async function verifyCredentials({ users, username, password }) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    await bcrypt.compare('', DUMMY_HASH);
    return { ok: false };
  }

  const user = users[username];
  const hash =
    user && typeof user.password_hash === 'string'
      ? user.password_hash
      : DUMMY_HASH;

  let matches = false;
  try {
    matches = await bcrypt.compare(password, hash);
  } catch {
    matches = false;
  }

  if (!user || !matches) return { ok: false };
  return { ok: true, username };
}

/**
 * Détecte si la requête attend une réponse JSON (API/media) plutôt
 * qu'une redirection HTML.
 *
 * ⚠️ Important : on utilise `req.originalUrl` et non `req.path`, car
 * `req.path` est réécrit par Express quand le routeur est monté sur un
 * préfixe (ex: app.use('/api', router) → req.path devient '/series').
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function wantsJson(req) {
  const url = req.originalUrl || req.url || req.path || '';
  if (url.startsWith('/api/') || url.startsWith('/media/')) return true;
  const accept = req.headers && req.headers.accept;
  if (typeof accept === 'string' && accept.includes('application/json')) {
    return true;
  }
  return false;
}

/**
 * Middleware : exige une session authentifiée.
 *  - Route HTML : redirect 302 vers /login
 *  - Route /api/* ou /media/* : 401 JSON
 */
function requireAuth(opts = {}) {
  const redirectTo = opts.redirectTo || '/login';
  return function (req, res, next) {
    if (req.session && req.session.user) return next();

    if (wantsJson(req)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return res.redirect(302, redirectTo);
  };
}

/**
 * Middleware : exige le rôle admin.
 */
function requireAdmin() {
  return function (req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ error: 'forbidden' });
  };
}

/**
 * Construit la config express-session.
 */
function buildSessionOptions({ sessionSecret, sessionMaxAgeHours, https }) {
  const maxAge = sessionMaxAgeHours * 60 * 60 * 1000;
  return {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!https,
      maxAge,
    },
  };
}

/**
 * Construit un routeur Express pour /login et /logout.
 */
function buildAuthRouter({
  users,
  rateLimiter,
  onLoginSuccess,
  onLoginFailure,
  onRateLimited,
}) {
  const express = require('express');
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const ip = (
      req.ip ||
      (req.connection && req.connection.remoteAddress) ||
      'unknown'
    ).toString();

    const peek = rateLimiter.peek(ip);
    if (!peek.allowed) {
      if (onRateLimited) onRateLimited(ip, peek.retryAfterSeconds);
      return res.status(429).json({
        error: 'too_many_attempts',
        retryAfterSeconds: peek.retryAfterSeconds,
      });
    }

    const username = String((req.body && req.body.username) || '');
    const password = String((req.body && req.body.password) || '');

    const result = await verifyCredentials({ users, username, password });

    if (!result.ok) {
      rateLimiter.register(ip);
      if (onLoginFailure) onLoginFailure(username, ip);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    rateLimiter.reset(ip);

    const role = username === 'admin' ? 'admin' : 'reader';
    req.session.user = { username, role };

    if (onLoginSuccess) onLoginSuccess(username, ip);

    return res.redirect(302, '/');
  });

  router.post('/logout', (req, res) => {
    if (req.session) {
      req.session.destroy(() => {});
    }
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });

  return router;
}

module.exports = {
  DUMMY_HASH,
  loadUsers,
  verifyCredentials,
  requireAuth,
  requireAdmin,
  wantsJson,
  buildSessionOptions,
  buildAuthRouter,
};