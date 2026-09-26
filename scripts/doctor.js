#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'config.json');
const USERS_PATH = path.join(PROJECT_ROOT, 'config', 'users.json');

const OK = '✅';
const WARN = '⚠️ ';
const FAIL = '❌';

let failures = 0;
let warnings = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`${OK} ${label}`);
    } else if (typeof result === 'string') {
      console.log(`${WARN}${label} — ${result}`);
      warnings++;
    }
  } catch (err) {
    console.log(`${FAIL} ${label} — ${err.message}`);
    failures++;
  }
}

async function checkAsync(label, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      console.log(`${OK} ${label}`);
    } else if (typeof result === 'string') {
      console.log(`${WARN}${label} — ${result}`);
      warnings++;
    }
  } catch (err) {
    console.log(`${FAIL} ${label} — ${err.message}`);
    failures++;
  }
}

async function main() {
  console.log('\n=== Diagnostic media-player-v2 ===\n');

  // 1. Node
  check(`Node ${process.version} ≥ 20`, () => {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 20) throw new Error(`Node ${major} détecté, 20+ requis`);
    return true;
  });

  // 2. .env
  check('.env présent', () => {
    if (!fs.existsSync(ENV_PATH)) throw new Error('absent');
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    if (!/^SESSION_SECRET=[0-9a-f]{64}/m.test(content)) {
      throw new Error('SESSION_SECRET manquant ou invalide');
    }
    return true;
  });

  // 3. config.json
  let config;
  check('config/config.json présent et valide', () => {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('absent');
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!config.ROOT_DIR) throw new Error('ROOT_DIR manquant');
    return true;
  });

  // 4. ROOT_DIR accessible
  check(`ROOT_DIR accessible (${config?.ROOT_DIR})`, () => {
    if (!config?.ROOT_DIR) return 'non défini';
    if (!fs.existsSync(config.ROOT_DIR)) throw new Error('introuvable');
    fs.readdirSync(config.ROOT_DIR);
    return true;
  });

  // 5. users.json
  check('config/users.json présent et valide', () => {
    if (!fs.existsSync(USERS_PATH)) throw new Error('absent');
    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    if (!users.reader || !users.reader.password_hash) {
      throw new Error('compte "reader" manquant');
    }
    if (!users.admin || !users.admin.password_hash) {
      throw new Error('compte "admin" manquant');
    }
    return true;
  });

  // 6. Hashs utilisables
  await checkAsync('Hashs bcrypt valides', async () => {
    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    for (const [name, u] of Object.entries(users)) {
      if (!/^\$2[aby]\$\d{2}\$/.test(u.password_hash)) {
        throw new Error(`hash invalide pour "${name}"`);
      }
    }
    return true;
  });

  // 7. Mots de passe par défaut
  await checkAsync('Mots de passe personnalisés', async () => {
    const users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    for (const [name, u] of Object.entries(users)) {
      if (await bcrypt.compare('changeme', u.password_hash)) {
        return `"${name}" utilise encore "changeme"`;
      }
    }
    return true;
  });

  // 8. Dossiers générés
  check('cache/ et logs/ présents', () => {
    const cacheDir = path.join(PROJECT_ROOT, 'cache');
    const logsDir = path.join(PROJECT_ROOT, 'logs');
    if (!fs.existsSync(cacheDir) || !fs.existsSync(logsDir)) {
      return 'seront créés au démarrage';
    }
    return true;
  });

  // Résumé
  console.log('');
  if (failures === 0 && warnings === 0) {
    console.log('🎉 Tout est prêt. Lancez :  npm start\n');
  } else if (failures === 0) {
    console.log(`✅ ${warnings} avertissement(s) non bloquant(s).\n`);
  } else {
    console.log(
      `❌ ${failures} erreur(s), ${warnings} avertissement(s). ` +
        'Corrigez avant de démarrer.\n'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});