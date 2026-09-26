#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const bcrypt = require('bcrypt');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const USERS_PATH = path.join(CONFIG_DIR, 'users.json');

const BCRYPT_COST = 12;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Génère un secret de session (64 hex).
 */
function generateSessionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Écrit un fichier seulement s'il n'existe pas déjà.
 * @returns {boolean} true si créé
 */
function writeIfMissing(filePath, content, mode = 0o600) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode });
  return true;
}

/**
 * Détecte si on est dans un environnement interactif (TTY).
 * @returns {boolean}
 */
function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY;
}

/**
 * Prompt simple (lecture d'une ligne).
 */
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * Prompt masqué (mot de passe).
 * @param {string} label
 * @returns {Promise<string>}
 */
function askPassword(label) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    stdout.write(label);

    let password = '';
    const onData = (char) => {
      const c = char.toString('utf8');

      if (c === '\n' || c === '\r' || c === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        stdin.pause();
        stdout.write('\n');
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl+C
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += c;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Génération des fichiers
// ---------------------------------------------------------------------------

/**
 * Charge la config.json existante ou retourne un objet vide.
 */
function readExistingConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Demande interactivement le ROOT_DIR.
 * @param {readline.Interface} rl
 * @param {string} defaultDir
 */
async function promptRootDir(rl, defaultDir) {
  const answer = await ask(
    rl,
    `📁 Dossier racine des médias [${defaultDir}] : `
  );
  const value = answer.trim();
  return value || defaultDir;
}

/**
 * Demande un mot de passe pour chaque utilisateur.
 * @param {string} username
 * @returns {Promise<string>}
 */
async function promptUserPassword(username) {
  while (true) {
    const pwd = await askPassword(`🔑 Mot de passe pour "${username}" : `);
    if (pwd.length < 6) {
      process.stdout.write('   ⚠️  Le mot de passe doit faire au moins 6 caractères.\n');
      continue;
    }
    const confirm = await askPassword(`   Confirmez : `);
    if (pwd !== confirm) {
      process.stdout.write('   ⚠️  Les mots de passe ne correspondent pas.\n');
      continue;
    }
    return pwd;
  }
}

/**
 * Crée `config/users.json` à partir des mots de passe fournis.
 * @param {{ reader: string, admin: string }} passwords
 */
async function writeUsersFile(passwords) {
  const users = {
    reader: { password_hash: await bcrypt.hash(passwords.reader, BCRYPT_COST) },
    admin: { password_hash: await bcrypt.hash(passwords.admin, BCRYPT_COST) },
  };

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]      - Force la régénération
 * @param {boolean} [opts.nonInteractive=false] - Mode non-interactif
 * @param {string}  [opts.rootDir]          - ROOT_DIR en non-interactif
 * @param {string}  [opts.readerPassword]   - Mot de passe reader en non-interactif
 * @param {string}  [opts.adminPassword]    - Mot de passe admin en non-interactif
 */
async function initProject(opts = {}) {
  const report = {
    envCreated: false,
    configCreated: false,
    usersCreated: false,
  };

  console.log('\n=== media-player-v2 — Installation ===\n');

  // --- 1. Détection de l'état ---------------------------------------------
  const envExists = fs.existsSync(ENV_PATH);
  const configExists = fs.existsSync(CONFIG_PATH);
  const usersExists = fs.existsSync(USERS_PATH);

  if (envExists && configExists && usersExists && !opts.force) {
    console.log('✅ Tout est déjà configuré. Rien à faire.\n');
    console.log('   Pour réinitialiser : node scripts/init.js --force\n');
    return report;
  }

  const interactive = !opts.nonInteractive && isInteractive();
  const existingConfig = readExistingConfig();

  // --- 2. Choix du ROOT_DIR -----------------------------------------------
  const defaultRoot = existingConfig.ROOT_DIR || path.join(PROJECT_ROOT, 'media');
  let rootDir = opts.rootDir || defaultRoot;

  if (interactive && !configExists) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      rootDir = await promptRootDir(rl, defaultRoot);
    } finally {
      rl.close();
    }
  }

  // --- 3. Mots de passe utilisateurs --------------------------------------
  let readerPassword = opts.readerPassword;
  let adminPassword = opts.adminPassword;

  if (!usersExists && !readerPassword) {
    if (!interactive) {
      // Non-interactif : mot de passe par défaut "changeme"
      readerPassword = 'changeme';
      adminPassword = 'changeme';
      console.warn(
        '⚠️  Mode non-interactif : mot de passe par défaut "changeme" ' +
          '(à changer immédiatement).'
      );
    } else {
      console.log('\nCréation des 2 comptes utilisateurs.\n');
      readerPassword = await promptUserPassword('reader');
      adminPassword = await promptUserPassword('admin');
      console.log('');
    }
  }

  // --- 4. Écriture .env ---------------------------------------------------
  if (!envExists || opts.force) {
    const envContent =
      '# Généré automatiquement par scripts/init.js\n' +
      `SESSION_SECRET=${generateSessionSecret()}\n`;
    fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
    fs.writeFileSync(ENV_PATH, envContent, { encoding: 'utf8', mode: 0o600 });
    report.envCreated = true;
    console.log('✅ .env généré');
  }

  // --- 5. Écriture config.json -------------------------------------------
  if (!configExists || opts.force) {
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

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, configContent, {
      encoding: 'utf8',
      mode: 0o600,
    });
    report.configCreated = true;
    console.log('✅ config/config.json généré');
  }

  // --- 6. Écriture users.json --------------------------------------------
  if (!usersExists || opts.force) {
    if (!readerPassword) {
      throw new Error(
        'Impossible de créer config/users.json : mots de passe manquants.'
      );
    }
    await writeUsersFile({
      reader: readerPassword,
      admin: adminPassword || readerPassword,
    });
    report.usersCreated = true;
    console.log('✅ config/users.json généré (2 comptes)');
  }

  // --- 7. Message final ---------------------------------------------------
  console.log('');
  if (!envExists && report.envCreated) {
    // pas de warning .gitignore — déjà configuré
  }
  if (rootDir === path.join(PROJECT_ROOT, 'media')) {
    console.log(
      `   ⚠️  ROOT_DIR pointe vers "${rootDir}" (dossier par défaut).`
    );
    console.log(
      '      Éditez config/config.json pour pointer vers votre médiathèque.'
    );
  }

  console.log('\nPour démarrer le serveur :  npm start\n');

  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const nonInteractive =
    args.includes('--yes') || args.includes('-y') || !isInteractive();

  try {
    await initProject({ force, nonInteractive });
  } catch (err) {
    console.error(`\n❌ Erreur : ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  initProject,
  generateSessionSecret,
  writeIfMissing,
  askPassword,
};

if (require.main === module) {
  main();
}