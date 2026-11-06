'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const registry = require('./registry');
const { requireAuth } = require('../auth');

const MAX_INPUT_LEN = 2048;

/**
 * Routeur Scrapper (V1.5) — Plan A : monté à la racine.
 *
 * Routes :
 *   GET /api/scrapper/config  → { enabled, roles, maxConcurrent?, reason? }
 *   GET /api/run?url=...      → SSE stream
 *
 * @param {object} params
 * @param {object} params.config - Config complète (cf. Lot 1)
 * @returns {import('express').Router}
 */
function buildScrapperRouter({ config }) {
  if (!config || typeof config !== 'object') {
    throw new Error('buildScrapperRouter: config est requis');
  }

  const router = express.Router();

  const pyCfg = config.python_module || null;
  const disabledReason = config.python_module_disabled_reason || 'not_configured';

  // ---- Rate limit dédié (D25) — uniquement si le module est actif ----
  let runLimiter = null;
  if (pyCfg && pyCfg.rate_limit) {
    runLimiter = rateLimit({
      windowMs: pyCfg.rate_limit.windowMinutes * 60 * 1000,
      max: pyCfg.rate_limit.maxAttempts,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'too_many_requests' },
    });
  }

  // -------------------------------------------------------------------
  // GET /api/scrapper/config — toujours accessible (mais authentifié)
  // pour que le front sache si le module est activé et si l'utilisateur
  // est autorisé (V1.5 — ajout de `roles` pour le lien de nav).
  // -------------------------------------------------------------------
  router.get('/api/scrapper/config', requireAuth(), (req, res) => {
    if (!pyCfg) {
      return res.json({
        enabled: false,
        reason: disabledReason,
        roles: [],
      });
    }
    return res.json({
      enabled: true,
      maxConcurrent: pyCfg.max_concurrent_per_session,
      roles: pyCfg.allowed_roles,
    });
  });

  // -------------------------------------------------------------------
  // GET /api/run — la route principale SSE
  // -------------------------------------------------------------------
  function runHandler(req, res) {
    if (!pyCfg) {
      return res.status(503).json({ error: 'scrapper_disabled' });
    }

    const user = (req.session && req.session.user) || null;
    const role = user ? user.role : 'reader';
    if (!Array.isArray(pyCfg.allowed_roles) || !pyCfg.allowed_roles.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const raw = req.query ? req.query.url : undefined;
    const input = String(raw ?? '').trim();
    if (input.length === 0) {
      return res.status(400).json({ error: 'missing_url' });
    }
    if (input.length > MAX_INPUT_LEN) {
      return res.status(400).json({ error: 'url_too_long' });
    }
    if (input.includes('\0')) {
      return res.status(400).json({ error: 'invalid_url' });
    }

    if (registry.countForSession(req.sessionID) >= pyCfg.max_concurrent_per_session) {
      return res.status(409).json({ error: 'already_running' });
    }
    if (registry.total() >= pyCfg.max_concurrent_global) {
      return res.status(429).json({ error: 'too_many_runs' });
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let run;
    try {
      run = registry.create({
        input,
        sessionId: req.sessionID,
        cfg: pyCfg,
      });
    } catch (err) {
      try {
        const msg = String(err && err.message ? err.message : err);
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`
        );
        res.write(
          `event: end\ndata: ${JSON.stringify({
            exitCode: -1,
            durationMs: 0,
            reason: 'error',
          })}\n\n`
        );
      } catch { /* ignore */ }
      try { res.end(); } catch { /* ignore */ }
      return;
    }

    run.attach(res);

    res.on('close', () => {
      if (!run.finished) run.kill('client_disconnected');
    });

    try {
      run.start();
    } catch {
      try { run.kill('spawn_failed'); } catch { /* ignore */ }
    }
  }

  const runChain = [];
  if (runLimiter) runChain.push(runLimiter);
  runChain.push(requireAuth());
  runChain.push(runHandler);
  router.get('/api/run', runChain);

  return router;
}

module.exports = { buildScrapperRouter, MAX_INPUT_LEN };