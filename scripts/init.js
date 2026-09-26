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
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
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
// Écriture des fichiers (logique partagée sync/async)
// ---------------------------------------------------------------------------

/**
 * Prépare le contenu de `.env`.
 */
function buildEnvContent() {
  return (
    '# Généré automatiquement par scripts/init.js\n' +
    `SESSION_SECRET=${generateSessionSecret()}\n`
  );
}

/**
 * Prépare le contenu de `config.json`.
 */
function buildConfigContent(rootDir) {
  return (
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
    ) + '\n'
  );
}

/**
 * Écrit `users.json` à partir de mots de passe EN CLAIR.
 * Version synchrone (bcrypt.hashSync).
 *
 * @param {{ reader: string, admin: string }} passwords
 * @param {string} usersPath
 */
function writeUsersFileSync(passwords, usersPath = USERS_PATH) {
  const users = {
    reader: { password_hash: bcrypt.hashSync(passwords.reader, BCRYPT_COST) },
    admin: {
      password_hash: bcrypt.hashSync(
        passwords.admin || passwords.reader,
        BCRYPT_COST
      ),
    },
  };

  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/**
 * Écrit `users.json` à partir de mots de passe EN CLAIR.
 * Version asynchrone (bcrypt.hash).
 *
 * @param {{ reader: string, admin: string }} passwords
 * @param {string} usersPath
 */
async function writeUsersFileAsync(passwords, usersPath = USERS_PATH) {
  const users = {
    reader: {
      password_hash: await bcrypt.hash(passwords.reader, BCRYPT_COST),
    },
    admin: {
      password_hash: await bcrypt.hash(
        passwords.admin || passwords.reader,
        BCRYPT_COST
      ),
    },
  };

  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Version SYNCHRONE (utilisée par config.js et les tests)
// ---------------------------------------------------------------------------

/**
 * Initialise le projet de façon SYNCHRONE.
 *
 * Utilisé par `config.js` (qui ne peut pas `await`) et les tests unitaires.
 *
 * Crée .env, config/config.json et config/users.json si absents.
 * Si les mots de passe ne sont pas fournis, utilise "changeme".
 *
 * @param {object} [opts]
 * @param {string} [opts.envPath]
 * @param {string} [opts.configPath]
 * @param {string} [opts.usersPath]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.readerPassword]
 * @param {string} [opts.adminPassword]
 * @param {boolean} [opts.force=false]
 * @returns {{ envCreated: boolean, configCreated: boolean, usersCreated: boolean, envPath: string, configPath: string, usersPath: string }}
 */
function initProjectSync(opts = {}) {
  const envPath = opts.envPath || ENV_PATH;
  const configPath = opts.configPath || CONFIG_PATH;
  const usersPath = opts.usersPath || USERS_PATH;
  const rootDir = opts.rootDir || path.join(PROJECT_ROOT, 'media');
  const force = !!opts.force;

  const envCreated =
    force || !fs.existsSync(envPath)
      ? (fs.mkdirSync(path.dirname(envPath), { recursive: true }),
        fs.writeFileSync(envPath, buildEnvContent(), {
          encoding: 'utf8',
          mode: 0o600,
        }),
        true)
      : false;

  const configCreated =
    force || !fs.existsSync(configPath)
      ? (fs.mkdirSync(path.dirname(configPath), { recursive: true }),
        fs.writeFileSync(configPath, buildConfigContent(rootDir), {
          encoding: 'utf8',
          mode: 0o600,
        }),
        true)
      : false;

  let usersCreated = false;
  if (force || !fs.existsSync(usersPath)) {
    writeUsersFileSync(
      {
        reader: opts.readerPassword || 'changeme',
        admin: opts.adminPassword || opts.readerPassword || 'changeme',
      },
      usersPath
    );
    usersCreated = true;
  }

  return {
    envCreated,
    configCreated,
    usersCreated,
    envPath,
    configPath,
    usersPath,
  };
}

// ---------------------------------------------------------------------------
// Version ASYNCHRONE / INTERACTIVE (utilisée par CLI)
// ---------------------------------------------------------------------------

/**
 * Charge la config.json existante ou retourne un objet vide.
 */
function readExistingConfig(configPath = CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Demande interactivement le ROOT_DIR.
 */
async function promptRootDir(rl, defaultDir) {
  const answer = await ask(rl, `📁 Dossier racine des médias [${defaultDir}] : `);
  const value = answer.trim();
  return value || defaultDir;
}

/**
 * Demande un mot de passe avec confirmation.
 */
async function promptUserPassword(username) {
  while (true) {
    const pwd = await askPassword(`🔑 Mot de passe pour "${username}" : `);
    if (pwd.length < 6) {
      process.stdout.write(
        '   ⚠️  Le mot de passe doit faire au moins 6 caractères.\n'
      );
      continue;
    }
    const confirm = await askPassword('   Confirmez : ');
    if (pwd !== confirm) {
      process.stdout.write('   ⚠️  Les mots de passe ne correspondent pas.\n');
      continue;
    }
    return pwd;
  }
}

/**
 * Initialise le projet de façon ASYNCHRONE et INTERACTIVE.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]
 * @param {boolean} [opts.nonInteractive=false]
 * @param {string}  [opts.rootDir]
 * @param {string}  [opts.readerPassword]
 * @param {string}  [opts.adminPassword]
 * @param {string}  [opts.envPath]
 * @param {string}  [opts.configPath]
 * @param {string}  [opts.usersPath]
 * @param {boolean} [opts.silent=false] - N'affiche rien (tests)
 * @returns {Promise<{ envCreated: boolean, configCreated: boolean, usersCreated: boolean }>}
 */
async function initProject(opts = {}) {
  const envPath = opts.envPath || ENV_PATH;
  const configPath = opts.configPath || CONFIG_PATH;
  const usersPath = opts.usersPath || USERS_PATH;
  const force = !!opts.force;
  const silent = !!opts.silent;

  const log = silent ? () => {} : (...a) => console.log(...a);

  const report = {
    envCreated: false,
    configCreated: false,
    usersCreated: false,
  };

  const envExists = fs.existsSync(envPath);
  const configExists = fs.existsSync(configPath);
  const usersExists = fs.existsSync(usersPath);

  if (envExists && configExists && usersExists && !force) {
    if (!silent) {
      console.log('✅ Tout est déjà configuré. Rien à faire.\n');
      console.log('   Pour réinitialiser : node scripts/init.js --force\n');
    }
    return report;
  }

  const interactive = !opts.nonInteractive && isInteractive();
  const existingConfig = readExistingConfig(configPath);

  // --- ROOT_DIR -----------------------------------------------------------
  const defaultRoot =
    existingConfig.ROOT_DIR || opts.rootDir || path.join(PROJECT_ROOT, 'media');
  let rootDir = defaultRoot;

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

  // --- Mots de passe ------------------------------------------------------
  let readerPassword = opts.readerPassword;
  let adminPassword = opts.adminPassword;

  if (!usersExists && !readerPassword) {
    if (!interactive) {
      readerPassword = 'changeme';
      adminPassword = 'changeme';
      if (!silent) {
        console.warn(
          '⚠️  Mode non-interactif : mot de passe par défaut "changeme" ' +
            '(à changer immédiatement).'
        );
      }
    } else {
      log('\nCréation des 2 comptes utilisateurs.\n');
      readerPassword = await promptUserPassword('reader');
      adminPassword = await promptUserPassword('admin');
      log('');
    }
  }

  // --- .env ---------------------------------------------------------------
  if (!envExists || force) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, buildEnvContent(), {
      encoding: 'utf8',
      mode: 0o600,
    });
    report.envCreated = true;
    log('✅ .env généré');
  }

  // --- config.json --------------------------------------------------------
  if (!configExists || force) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, buildConfigContent(rootDir), {
      encoding: 'utf8',
      mode: 0o600,
    });
    report.configCreated = true;
    log('✅ config/config.json généré');
  }

  // --- users.json ---------------------------------------------------------
  if (!usersExists || force) {
    if (!readerPassword) {
      throw new Error(
        'Impossible de créer config/users.json : mots de passe manquants.'
      );
    }
    await writeUsersFileAsync(
      {
        reader: readerPassword,
        admin: adminPassword || readerPassword,
      },
      usersPath
    );
    report.usersCreated = true;
    log('✅ config/users.json généré (2 comptes)');
  }

  // --- Message final ------------------------------------------------------
  log('');
  if (
    rootDir === path.join(PROJECT_ROOT, 'media') &&
    !opts.rootDir
  ) {
    log(`   ⚠️  ROOT_DIR pointe vers "${rootDir}" (dossier par défaut).`);
    log(
      '      Éditez config/config.json pour pointer vers votre médiathèque.'
    );
  }

  if (!silent) {
    console.log('\nPour démarrer le serveur :  npm start\n');
  }

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

  console.log('\n=== media-player-v2 — Installation ===\n');

  try {
    await initProject({ force, nonInteractive });
  } catch (err) {
    console.error(`\n❌ Erreur : ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  initProject,
  initProjectSync,
  generateSessionSecret,
  writeIfMissing,
  askPassword,
  writeUsersFileSync,
  writeUsersFileAsync,
  buildEnvContent,
  buildConfigContent,
};

if (require.main === module) {
  main();
}