#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);

/**
 * Génère un SESSION_SECRET de 64 caractères hexadécimaux.
 * @returns {string}
 */
function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex'); // 32 bytes → 64 hex
}

/**
 * Écrit un fichier seulement s'il n'existe pas déjà.
 * @returns {boolean} true si créé, false si déjà présent
 */
function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  return true;
}

/**
 * Génère `.env` et `config/config.json` s'ils sont absents (G3).
 * @param {object} [opts]
 * @param {string} [opts.envPath]
 * @param {string} [opts.configPath]
 * @param {string} [opts.rootDir]
 * @returns {{ envCreated: boolean, configCreated: boolean, envPath: string, configPath: string }}
 */
function initProject(opts = {}) {
  const envPath = opts.envPath || ENV_PATH;
  const configPath = opts.configPath || CONFIG_PATH;
  const rootDir = opts.rootDir || path.join(PROJECT_ROOT, 'media');

  const envContent =
    '# Généré automatiquement par scripts/init.js\n' +
    `SESSION_SECRET=${generateSessionSecret()}\n`;

  const configContent =
    JSON.stringify(
      {
        ROOT_DIR: rootDir,
        USERS_FILE: './config/users.json',
        CACHE_FILE: './cache/scan.json',
        WARNINGS_FILE: './logs/scan-warnings.log',
        APP_LOG_FILE: './logs/app.jsonl',
        SESSION_MAX_AGE_HOURS: 24,
        PORT: 3000,
        HTTPS: false,
        SCAN_ON_START: true,
        LOGIN_RATE_LIMIT: { windowMinutes: 15, maxAttempts: 5 },
      },
      null,
      2
    ) + '\n';

  const envCreated = writeIfMissing(envPath, envContent);
  const configCreated = writeIfMissing(configPath, configContent);

  return { envCreated, configCreated, envPath, configPath };
}

function main() {
  const res = initProject();
  if (res.envCreated) {
    console.log(`✅ .env généré : ${res.envPath}`);
    console.warn('⚠️  Pense à ajouter .env à .gitignore (déjà prévu).');
  } else {
    console.log(`ℹ️  .env déjà présent : ${res.envPath}`);
  }
  if (res.configCreated) {
    console.log(`✅ config.json généré : ${res.configPath}`);
    console.warn('⚠️  Édite ROOT_DIR pour pointer vers ta médiathèque.');
  } else {
    console.log(`ℹ️  config.json déjà présent : ${res.configPath}`);
  }
}

module.exports = { initProject, generateSessionSecret, writeIfMissing };

if (require.main === module) {
  main();
}