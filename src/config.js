'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { initProjectSync } = require('../scripts/init');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, '.env');
const DEFAULT_USERS_PATH = path.join(PROJECT_ROOT, 'config', 'users.json');

/**
 * Valeurs par défaut de la configuration (cf. §13.3 du CDC V2).
 */
const DEFAULTS = {
  ROOT_DIR: path.join(PROJECT_ROOT, 'media'),
  USERS_FILE: './config/users.json',
  CACHE_FILE: './cache/scan.json',
  WARNINGS_FILE: './logs/scan-warnings.log',
  APP_LOG_FILE: './logs/app.json',
  SESSION_MAX_AGE_HOURS: 24,
  PORT: 3000,
  HTTPS: false,
  SCAN_ON_START: true,
  LOGIN_RATE_LIMIT: { windowMinutes: 15, maxAttempts: 5 },
};

/**
 * Valeurs par défaut du bloc python_module (V1.5 → V1.6).
 *
 * V1.6 ajoute `create_dest_if_missing` (défaut true) : si le dossier
 * de destination `ROOT_DIR/{series}/{folder}` n'existe pas, le serveur
 * le crée avant de lancer le script Python.
 */
const PYTHON_MODULE_DEFAULTS = Object.freeze({
  script_path: null,
  python_executable: 'python3',
  cwd: null,
  timeout_seconds: 600,
  max_concurrent_per_session: 1,
  max_concurrent_global: 3,
  allowed_roles: ['admin'],
  rate_limit: { windowMinutes: 5, maxAttempts: 10 },
  create_dest_if_missing: true,
});

/**
 * Parse un fichier .env minimaliste au format KEY=VALUE.
 */
function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;

  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }

  return out;
}

/**
 * Valide et normalise le bloc `python_module` (V1.5 → V1.6).
 *
 * @param {unknown} raw
 * @returns {{ ok: true, value: object } | { ok: false, reason: string, detail?: object }}
 */
function validatePythonModule(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: 'absent' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid_type' };
  }

  // ---- script_path ----
  if (!raw.script_path || typeof raw.script_path !== 'string') {
    return { ok: false, reason: 'script_path_missing' };
  }
  const scriptAbs = path.resolve(PROJECT_ROOT, raw.script_path);
  if (!fs.existsSync(scriptAbs)) {
    return { ok: false, reason: 'script_not_found', detail: { path: scriptAbs } };
  }

  // ---- python_executable ----
  const pythonExec =
    typeof raw.python_executable === 'string' && raw.python_executable.trim()
      ? raw.python_executable.trim()
      : PYTHON_MODULE_DEFAULTS.python_executable;

  try {
    const probe = spawnSync(pythonExec, ['--version'], {
      timeout: 5000,
      shell: false,
      stdio: 'ignore',
    });
    if (probe.error && probe.error.code === 'ENOENT') {
      return {
        ok: false,
        reason: 'python_executable_not_found',
        detail: { executable: pythonExec },
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'python_executable_probe_failed',
      detail: { message: err.message },
    };
  }

  // ---- cwd ----
  let cwd;
  if (raw.cwd && typeof raw.cwd === 'string' && raw.cwd.trim()) {
    cwd = path.resolve(PROJECT_ROOT, raw.cwd.trim());
    if (!fs.existsSync(cwd)) {
      return { ok: false, reason: 'cwd_not_found', detail: { path: cwd } };
    }
  } else {
    cwd = path.dirname(scriptAbs);
  }

  // ---- timeout_seconds ----
  const rawTimeout = Number(raw.timeout_seconds);
  const timeoutSeconds =
    Number.isFinite(rawTimeout) && rawTimeout >= 10
      ? Math.floor(rawTimeout)
      : PYTHON_MODULE_DEFAULTS.timeout_seconds;

  // ---- concurrence ----
  const rawPerSession = Number(raw.max_concurrent_per_session);
  const maxPerSession =
    Number.isFinite(rawPerSession) && rawPerSession >= 1
      ? Math.floor(rawPerSession)
      : PYTHON_MODULE_DEFAULTS.max_concurrent_per_session;

  const rawGlobal = Number(raw.max_concurrent_global);
  const maxGlobal =
    Number.isFinite(rawGlobal) && rawGlobal >= 1
      ? Math.floor(rawGlobal)
      : PYTHON_MODULE_DEFAULTS.max_concurrent_global;

  // ---- allowed_roles ----
  const rawRoles = Array.isArray(raw.allowed_roles)
    ? raw.allowed_roles
    : PYTHON_MODULE_DEFAULTS.allowed_roles;
  const allowedRoles = rawRoles.filter(
    (r) => r === 'reader' || r === 'admin'
  );
  if (allowedRoles.length === 0) {
    return { ok: false, reason: 'no_valid_role' };
  }

  // ---- rate_limit ----
  const rawRl = raw.rate_limit && typeof raw.rate_limit === 'object'
    ? raw.rate_limit
    : PYTHON_MODULE_DEFAULTS.rate_limit;
  const rlWindow = Number(rawRl.windowMinutes);
  const rlMax = Number(rawRl.maxAttempts);
  const rateLimit = {
    windowMinutes:
      Number.isFinite(rlWindow) && rlWindow >= 1
        ? Math.floor(rlWindow)
        : PYTHON_MODULE_DEFAULTS.rate_limit.windowMinutes,
    maxAttempts:
      Number.isFinite(rlMax) && rlMax >= 1
        ? Math.floor(rlMax)
        : PYTHON_MODULE_DEFAULTS.rate_limit.maxAttempts,
  };

  // ---- create_dest_if_missing (V1.6) ----
  let createDestIfMissing = PYTHON_MODULE_DEFAULTS.create_dest_if_missing;
  if (raw.create_dest_if_missing !== undefined) {
    if (typeof raw.create_dest_if_missing !== 'boolean') {
      return { ok: false, reason: 'invalid_create_dest_if_missing' };
    }
    createDestIfMissing = raw.create_dest_if_missing;
  }

  return {
    ok: true,
    value: {
      script_path: scriptAbs,
      python_executable: pythonExec,
      cwd,
      timeout_seconds: timeoutSeconds,
      max_concurrent_per_session: maxPerSession,
      max_concurrent_global: maxGlobal,
      allowed_roles: allowedRoles,
      rate_limit: rateLimit,
      create_dest_if_missing: createDestIfMissing,
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton (accès global sans recharger le fichier)
// ---------------------------------------------------------------------------

let _configInstance = null;

/**
 * Récupère la configuration active.
 * @throws {Error} si `loadConfig()` n'a pas encore été appelé.
 * @returns {object}
 */
function getConfig() {
  if (!_configInstance) {
    throw new Error(
      'Configuration non initialisée. Appelle loadConfig() au démarrage du serveur.'
    );
  }
  return _configInstance;
}

/**
 * Force la configuration active (utile pour les tests).
 * @param {object|null} cfg
 */
function setConfig(cfg) {
  _configInstance = cfg;
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

/**
 * Charge la configuration depuis .env + config.json.
 *
 * G3 : si .env ou config.json sont absents, ils sont générés
 * automatiquement via initProjectSync() avec un warning console.
 *
 * V1.5 : si `python_module` est présent mais invalide, un warning console
 * est émis, `config.python_module` reste `null` et
 * `config.python_module_disabled_reason` contient la raison. Aucun throw.
 *
 * @param {object} [opts]
 * @param {string} [opts.configPath]
 * @param {string} [opts.envPath]
 * @param {string} [opts.usersPath]
 * @returns {{
 *   config: object,
 *   sessionSecret: string,
 *   generated: { env: boolean, config: boolean, users: boolean }
 * }}
 */
function loadConfig(opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const envPath = opts.envPath || DEFAULT_ENV_PATH;
  const usersPath = opts.usersPath || DEFAULT_USERS_PATH;

  const generated = { env: false, config: false, users: false };

  // --- G3 : génération automatique si absent -------------------------------
  const needEnv = !fs.existsSync(envPath);
  const needConfig = !fs.existsSync(configPath);
  const needUsers = !fs.existsSync(usersPath);

  if (needEnv || needConfig || needUsers) {
    const res = initProjectSync({
      envPath,
      configPath,
      usersPath,
      rootDir: DEFAULTS.ROOT_DIR,
    });
    generated.env = res.envCreated;
    generated.config = res.configCreated;
    generated.users = res.usersCreated;

    if (generated.env || generated.config || generated.users) {
      console.warn(
        '[config] Fichier(s) de configuration généré(s) par défaut. ' +
          'Édite-les avant la mise en production.'
      );
    }
  }

  // --- Lecture locale du .env (aucun effet de bord) ------------------------
  const envVars = parseEnvFile(envPath);

  // --- Lecture de config.json ---------------------------------------------
  let rawConfig = {};
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.warn(`[config] Impossible de lire ${configPath} : ${err.message}`);
  }

  // --- Fusion avec les défauts --------------------------------------------
  const config = { ...DEFAULTS, ...rawConfig };

  config.LOGIN_RATE_LIMIT = {
    ...DEFAULTS.LOGIN_RATE_LIMIT,
    ...(rawConfig.LOGIN_RATE_LIMIT || {}),
  };

  // --- python_module (V1.5 → V1.6) ----------------------------------------
  const pyValidation = validatePythonModule(rawConfig.python_module);
  if (pyValidation.ok) {
    config.python_module = pyValidation.value;
    config.python_module_disabled_reason = null;
  } else {
    config.python_module = null;
    config.python_module_disabled_reason = pyValidation.reason;

    if (rawConfig.python_module !== undefined) {
      const detail = pyValidation.detail
        ? ' ' + JSON.stringify(pyValidation.detail)
        : '';
      console.warn(
        `[config] python_module invalide (${pyValidation.reason}).${detail} ` +
          'Module Scrapper désactivé.'
      );
    }
  }

  // --- PORT : .env > process.env > config.json > défaut --------------------
  const portSource = envVars.PORT || process.env.PORT;
  if (portSource) {
    const p = parseInt(portSource, 10);
    if (!Number.isNaN(p)) config.PORT = p;
  }

  // --- SESSION_SECRET : .env > process.env > erreur ------------------------
  const sessionSecret = envVars.SESSION_SECRET || process.env.SESSION_SECRET;

  if (!sessionSecret) {
    throw new Error(
      'SESSION_SECRET manquant. Lance `npm run init` ou vérifie ton .env.'
    );
  }

  // --- Singleton ----------------------------------------------------------
  setConfig(config);

  return { config, sessionSecret, generated };
}

module.exports = {
  loadConfig,
  parseEnvFile,
  validatePythonModule,
  getConfig,
  setConfig,
  DEFAULTS,
  PYTHON_MODULE_DEFAULTS,
};