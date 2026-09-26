'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  APP_LOG_FILE: './logs/app.jsonl',
  SESSION_MAX_AGE_HOURS: 24,
  PORT: 3000,
  HTTPS: false,
  SCAN_ON_START: true,
  LOGIN_RATE_LIMIT: { windowMinutes: 15, maxAttempts: 5 },
};

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
 * Charge la configuration depuis .env + config.json.
 *
 * G3 : si .env ou config.json sont absents, ils sont générés
 * automatiquement via initProjectSync() avec un warning console.
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

  return { config, sessionSecret, generated };
}

module.exports = {
  loadConfig,
  parseEnvFile,
  DEFAULTS,
};