'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('./registry');
const { requireAuth } = require('../auth');

const MAX_INPUT_LEN = 2048;
const VALID_FOLDERS = Object.freeze([
  'comics',
  'comics_admin',
  'img',
  'img_admin',
]);

function resolveRootDir(config) {
  if (config && config.ROOT_DIR) return path.resolve(config.ROOT_DIR);
  return process.cwd();
}

/**
 * Trouve le meilleur cache disponible. Ordre de priorité :
 *   1. config.CACHE_FILE (explicite — prod, fixture adapté)
 *   2. <dirname(ROOT_DIR)>/cache/scan.json (si ROOT_DIR explicite)
 *   3. tests/e2e/.tmp-root/cache/scan.json (fallback E2E)
 *   4. .tmp-root/cache/scan.json (fallback E2E alternatif)
 *   5. ./cache/scan.json (fallback prod)
 */
function findCacheFile(config) {
  const candidates = [];
  if (config && config.CACHE_FILE) {
    candidates.push(path.resolve(config.CACHE_FILE));
  }
  if (config && config.ROOT_DIR) {
    candidates.push(
      path.join(path.dirname(path.resolve(config.ROOT_DIR)), 'cache', 'scan.json'),
    );
  }
  candidates.push(
    path.join(process.cwd(), 'tests', 'e2e', '.tmp-root', 'cache', 'scan.json'),
  );
  candidates.push(
    path.join(process.cwd(), '.tmp-root', 'cache', 'scan.json'),
  );
  candidates.push(path.join(process.cwd(), 'cache', 'scan.json'));

  return candidates.find((c) => fs.existsSync(c)) || null;
}

/**
 * Déduit rootDir depuis cacheFile si config.ROOT_DIR est absent.
 * Si cacheFile = X/cache/scan.json et que X/media existe, rootDir = X/media.
 */
function findRootDir(config, cacheFile) {
  if (config && config.ROOT_DIR) return path.resolve(config.ROOT_DIR);
  if (cacheFile) {
    const possibleMedia = path.join(
      path.dirname(path.dirname(cacheFile)),
      'media',
    );
    if (fs.existsSync(possibleMedia)) return possibleMedia;
  }
  return process.cwd();
}

function findWarningsFile(config, rootDir) {
  const candidates = [];
  if (config && config.WARNINGS_FILE) {
    candidates.push(path.resolve(config.WARNINGS_FILE));
  }
  candidates.push(
    path.join(path.dirname(rootDir), 'logs', 'scan-warnings.log'),
  );
  candidates.push(path.join(process.cwd(), 'logs', 'scan-warnings.log'));
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

/**
 * Charge une instance Store et son cache.
 */
function loadStoreInstance(StoreClass, config) {
  const cacheFile = findCacheFile(config);
  if (!cacheFile) {
    // eslint-disable-next-line no-console
    console.warn('[scrapper] aucun cache trouvé');
    return null;
  }
  const rootDir = findRootDir(config, cacheFile);
  const warningsFile = findWarningsFile(config, rootDir);

  let inst;
  try {
    inst = new StoreClass({ rootDir, cacheFile, warningsFile });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[scrapper] new Store() a throw —', err && err.message);
    return null;
  }

  if (typeof inst.loadFromCache === 'function') {
    try {
      inst.loadFromCache();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[scrapper] loadFromCache() a throw —', err && err.message);
    }
  }

  return inst;
}

/**
 * Construit le storeApi consommé par les routes.
 *
 * @param {object|null} injectedStore - Instance Store injectée (prod)
 * @param {object} config
 * @returns {{ listSeries: Function, getSerie: Function, source: string } | null}
 */
function buildStoreApi(injectedStore, config) {
  // Mode 1 : injection (prod, recommandé)
  if (
    injectedStore &&
    typeof injectedStore.listSeries === 'function' &&
    typeof injectedStore.getSerie === 'function'
  ) {
    return {
      listSeries: injectedStore.listSeries.bind(injectedStore),
      getSerie: injectedStore.getSerie.bind(injectedStore),
      source: 'injected',
    };
  }

  // Mode 2 : lazy-load depuis module.exports.Store
  let StoreClass;
  try {
    StoreClass = require('../store').Store;
  } catch {
    return null;
  }
  if (typeof StoreClass !== 'function') return null;

  return {
    listSeries: async (role) => {
      const inst = loadStoreInstance(StoreClass, config);
      if (!inst) return [];
      return inst.listSeries(role);
    },
    getSerie: async (serie, role) => {
      const inst = loadStoreInstance(StoreClass, config);
      if (!inst) return null;
      return inst.getSerie(serie, role);
    },
    source: 'lazy-load',
  };
}

async function listSeriesForRole(storeApi, role) {
  const result = await Promise.resolve(storeApi.listSeries(role));

  const toNames = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => (typeof s === 'string' ? s : s && s.name))
      .filter((n) => typeof n === 'string' && n.length > 0);

  if (Array.isArray(result)) return toNames(result);
  if (result && Array.isArray(result.series)) return toNames(result.series);
  return [];
}

async function serieExists(storeApi, serie, role) {
  const out = await Promise.resolve(storeApi.getSerie(serie, role));
  return !!out;
}

function buildScrapperRouter({ config, store: injectedStore }) {
  if (!config || typeof config !== 'object') {
    throw new Error('buildScrapperRouter: config est requis');
  }

  const storeApi = buildStoreApi(injectedStore, config);

  if (!storeApi) {
    // eslint-disable-next-line no-console
    console.warn('[scrapper] store introuvable (ni injection ni module.exports.Store)');
  } else {
    // eslint-disable-next-line no-console
    console.info(`[scrapper] store mode: ${storeApi.source}`);
  }

  const router = express.Router();

  const pyCfg = config.python_module || null;
  const disabledReason =
    config.python_module_disabled_reason || 'not_configured';
  const rootDir = resolveRootDir(config);

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

  router.get('/api/scrapper/config', requireAuth(), async (req, res) => {
    try {
      if (!pyCfg) {
        return res.json({ enabled: false, reason: disabledReason, roles: [] });
      }

      const user = (req.session && req.session.user) || null;
      const role = user ? user.role : null;
      const allowed =
        !!role &&
        Array.isArray(pyCfg.allowed_roles) &&
        pyCfg.allowed_roles.includes(role);

      if (!allowed) {
        return res.json({
          enabled: true,
          allowed: false,
          reason: 'forbidden_role',
          roles: pyCfg.allowed_roles,
        });
      }

      let series = [];
      let warning;
      if (!storeApi) {
        warning = 'store_unavailable';
      } else {
        try {
          series = await listSeriesForRole(storeApi, role);
        } catch (err) {
          warning = 'store_error';
          // eslint-disable-next-line no-console
          console.warn('[scrapper] listSeries a échoué :', err && err.message);
        }
      }

      const payload = {
        enabled: true,
        allowed: true,
        maxConcurrent: pyCfg.max_concurrent_per_session,
        roles: pyCfg.allowed_roles,
        series,
        folders: VALID_FOLDERS.slice(),
        rootDir,
      };
      if (warning) payload.warning = warning;
      return res.json(payload);
    } catch {
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  async function runHandler(req, res) {
    try {
      if (!pyCfg) {
        return res.status(503).json({ error: 'scrapper_disabled' });
      }
      if (!storeApi) {
        return res.status(503).json({ error: 'scrapper_store_unavailable' });
      }

      const user = (req.session && req.session.user) || null;
      const role = user ? user.role : 'reader';
      if (
        !Array.isArray(pyCfg.allowed_roles) ||
        !pyCfg.allowed_roles.includes(role)
      ) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const rawUrl = req.query ? req.query.url : undefined;
      const input = String(rawUrl ?? '').trim();
      if (input.length === 0) {
        return res.status(400).json({ error: 'missing_url' });
      }
      if (input.length > MAX_INPUT_LEN) {
        return res.status(400).json({ error: 'url_too_long' });
      }
      if (input.includes('\0')) {
        return res.status(400).json({ error: 'invalid_url' });
      }

      const rawSeries = req.query ? req.query.series_dest : undefined;
      const seriesDest = String(rawSeries ?? '').trim();
      if (seriesDest.length === 0) {
        return res.status(400).json({ error: 'missing_series_dest' });
      }
      if (
        seriesDest.includes('\0') ||
        seriesDest.includes('/') ||
        seriesDest.includes('\\') ||
        seriesDest === '.' ||
        seriesDest === '..'
      ) {
        return res.status(400).json({ error: 'invalid_series_dest' });
      }

      const rawFolder = req.query ? req.query.folder_dest : undefined;
      const folderDest = String(rawFolder ?? '').trim();
      if (folderDest.length === 0) {
        return res.status(400).json({ error: 'missing_folder_dest' });
      }
      if (!VALID_FOLDERS.includes(folderDest)) {
        return res.status(400).json({ error: 'invalid_folder_dest' });
      }

      let known = false;
      try {
        known = await serieExists(storeApi, seriesDest, role);
      } catch {
        return res.status(500).json({ error: 'internal_error' });
      }
      if (!known) {
        return res.status(404).json({ error: 'unknown_series' });
      }

      const destPath = path.resolve(rootDir, seriesDest, folderDest);
      const expectedPrefix = rootDir.endsWith(path.sep)
        ? rootDir
        : rootDir + path.sep;
      if (!destPath.startsWith(expectedPrefix)) {
        return res.status(403).json({ error: 'path_traversal' });
      }

      const createMissing = pyCfg.create_dest_if_missing !== false;
      if (!fs.existsSync(destPath)) {
        if (!createMissing) {
          return res.status(404).json({ error: 'dest_missing' });
        }
        try {
          fs.mkdirSync(destPath, { recursive: true });
        } catch {
          return res.status(500).json({ error: 'dest_creation_failed' });
        }
      }

      if (
        registry.countForSession(req.sessionID) >=
        pyCfg.max_concurrent_per_session
      ) {
        return res.status(409).json({ error: 'already_running' });
      }
      if (registry.total() >= pyCfg.max_concurrent_global) {
        return res.status(429).json({ error: 'too_many_runs' });
      }

      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let run;
      try {
        run = registry.create({
          input,
          sessionId: req.sessionID,
          cfg: pyCfg,
          dest: destPath,
          seriesDest,
          folderDest,
        });
      } catch (err) {
        try {
          const msg = String(err && err.message ? err.message : err);
          res.write(
            `event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`,
          );
          res.write(
            `event: end\ndata: ${JSON.stringify({
              exitCode: -1,
              durationMs: 0,
              reason: 'error',
            })}\n\n`,
          );
        } catch {
          /* ignore */
        }
        try {
          res.end();
        } catch {
          /* ignore */
        }
        return;
      }

      run.attach(res);
      res.on('close', () => {
        if (!run.finished) run.kill('client_disconnected');
      });

      try {
        run.start();
      } catch {
        try {
          run.kill('spawn_failed');
        } catch {
          /* ignore */
        }
      }
    } catch {
      try {
        if (!res.headersSent) {
          return res.status(500).json({ error: 'internal_error' });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const runChain = [];
  if (runLimiter) runChain.push(runLimiter);
  runChain.push(requireAuth());
  runChain.push(runHandler);
  router.get('/api/run', runChain);

  return router;
}

module.exports = {
  buildScrapperRouter,
  MAX_INPUT_LEN,
  VALID_FOLDERS,
};