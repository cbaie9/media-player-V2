'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { initProject } = require('../scripts/init');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, '.env');

/**
 * Valeurs par défaut de la configuration (cf. §13.3 du CDC V2).
 * Utilisées si config.json est absent ou incomplet.
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
 * - Ignore les lignes vides et les commentaires commençant par #.
 * - Retire les guillemets simples ou doubles autour de la valeur.
 * - N'injecte RIEN dans process.env : retourne un objet isolé.
 *
 * @param {string} filePath - Chemin absolu du fichier .env
 * @returns {Record<string, string>}
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

    // Retire les guillemets éventuels
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
 * Ordre de priorité pour PORT et SESSION_SECRET :
 *   1. .env local
 *   2. process.env (surcharge runtime)
 *   3. config.json (pour PORT uniquement)
 *   4. DEFAULTS
 *
 * G3 : si .env ou config.json sont absents, ils sont générés
 * automatiquement via initProject() avec un warning console.
 *
 * @param {object} [opts]
 * @param {string} [opts.configPath] - Chemin alternatif vers config.json
 * @param {string} [opts.envPath]    - Chemin alternatif vers .env
 * @returns {{
 *   config: object,
 *   sessionSecret: string,
 *   generated: { env: boolean, config: boolean }
 * }}
 */
function loadConfig(opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  const envPath = opts.envPath || DEFAULT_ENV_PATH;

  const generated = { env: false, config: false };

  // --- G3 : génération automatique si absent -------------------------------
  if (!fs.existsSync(envPath) || !fs.existsSync(configPath)) {
    const res = initProject({
      envPath,
      configPath,
      rootDir: DEFAULTS.ROOT_DIR,
    });
    generated.env = res.envCreated;
    generated.config = res.configCreated;

    if (generated.env || generated.config) {
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

  // Fusion imbriquée pour LOGIN_RATE_LIMIT
  config.LOGIN_RATE_LIMIT = {
    ...DEFAULTS.LOGIN_RATE_LIMIT,
    ...(rawConfig.LOGIN_RATE_LIMIT || {}),
  };

  // --- PORT : priorité .env > process.env > config.json > défaut ----------
  const portSource = envVars.PORT || process.env.PORT;
  if (portSource) {
    const p = parseInt(portSource, 10);
    if (!Number.isNaN(p)) config.PORT = p;
  }

  // --- SESSION_SECRET : .env > process.env > erreur -----------------------
  const sessionSecret =
    envVars.SESSION_SECRET || process.env.SESSION_SECRET;

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